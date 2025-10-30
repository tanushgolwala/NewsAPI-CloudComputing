package fetchcontroller

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"newsfetcher/initializer"
	"newsfetcher/models"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var topics = []string{
	"Technology",
	"Climate",
	"Economy",
	"Health",
	"Diplomacy",
	"Culture",
}

type newsAPIResponse struct {
	Status       string           `json:"status"`
	TotalResults int              `json:"totalResults"`
	NextPage     string           `json:"nextPage"`
	Results      []newsAPIArticle `json:"results"`
	Articles     []newsAPIArticle `json:"articles"`
}

func (payload newsAPIResponse) Items() []newsAPIArticle {
	if len(payload.Results) > 0 {
		return payload.Results
	}
	return payload.Articles
}

type newsAPIArticle struct {
	ArticleID   string   `json:"article_id"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Link        string   `json:"link"`
	URL         string   `json:"url"`
	ImageURL    string   `json:"image_url"`
	URLToImage  string   `json:"urlToImage"`
	Content     string   `json:"content"`
	PubDate     string   `json:"pubDate"`
	PublishedAt string   `json:"publishedAt"`
	Creator     []string `json:"creator"`
	Author      string   `json:"author"`
}

func (article newsAPIArticle) ArticleURL() string {
	if url := strings.TrimSpace(article.URL); url != "" {
		return url
	}
	return strings.TrimSpace(article.Link)
}

func (article newsAPIArticle) ImageLink() string {
	if image := strings.TrimSpace(article.URLToImage); image != "" {
		return image
	}
	return strings.TrimSpace(article.ImageURL)
}

func (article newsAPIArticle) PrimaryAuthor() string {
	if len(article.Creator) > 0 {
		for _, creator := range article.Creator {
			if name := strings.TrimSpace(creator); name != "" {
				return name
			}
		}
	}
	return strings.TrimSpace(article.Author)
}

func FetchNewsFromAPI(ctx context.Context, topic, apiKey string) ([]newsAPIArticle, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://newsapi.org/v2/everything", nil)
	if err != nil {
		return nil, err
	}

	query := req.URL.Query()
	query.Set("q", topic)
	query.Set("apikey", apiKey)
	if page := strings.TrimSpace(os.Getenv("NEWSDATA_PAGE")); page != "" {
		query.Set("page", page)
	}
	req.URL.RawQuery = query.Encode()

	response, err := newsAPIHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %d from NewsData API", response.StatusCode)
	}

	var payload newsAPIResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, err
	}
	if payload.Status != "" && payload.Status != "success" && payload.Status != "ok" {
		return nil, fmt.Errorf("newsdata API returned status %q", payload.Status)
	}
	return payload.Items(), nil
}

var (
	newsAPIHTTPClient = &http.Client{
		Timeout: 15 * time.Second,
	}
)

func uploadArticleText(ctx context.Context, client *s3.Client, bucket, key, body string) error {
	_, err := client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(bucket),
		Key:         aws.String(key),
		Body:        strings.NewReader(body),
		ContentType: aws.String("text/plain; charset=utf-8"),
	})
	return err
}

func buildArticleText(article newsAPIArticle) string {
	title := strings.TrimSpace(article.Title)
	description := strings.TrimSpace(article.Description)

	if description == "" {
		description = strings.TrimSpace(article.Content)
	}
	if description == "" {
		description = "Description unavailable."
	}

	return fmt.Sprintf("Title: %s\n\nDescription: %s\n", title, description)
}

func FetchNews(c *fiber.Ctx) error {
	apiKey := os.Getenv("NEWS_API_KEY")
	if apiKey == "" {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "API key not set",
		})
	}

	bucket := os.Getenv("AWS_S3_BUCKET")
	region := os.Getenv("AWS_REGION")
	if bucket == "" || region == "" {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "AWS_S3_BUCKET and AWS_REGION must be set",
		})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("Failed to load AWS config: %v", err),
		})
	}

	s3Client := s3.NewFromConfig(cfg)
	presignClient := s3.NewPresignClient(s3Client)

	presignTTL := 24 * time.Hour
	if ttlStr := os.Getenv("S3_PRESIGN_TTL"); ttlStr != "" {
		if ttl, err := time.ParseDuration(ttlStr); err == nil && ttl > 0 {
			presignTTL = ttl
		}
	}

	db := initializer.Database.Db
	if db == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "database connection unavailable",
		})
	}
	type topicSummary struct {
		Stored  int `json:"stored"`
		Updated int `json:"updated"`
		Skipped int `json:"skipped"`
	}

	results := make(map[string]topicSummary)

	for _, topic := range topics {
		topicCtx, cancelTopic := context.WithTimeout(ctx, 20*time.Second)

		tag := strings.ToLower(topic)
		articles, err := FetchNewsFromAPI(topicCtx, topic, apiKey)
		cancelTopic()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": fmt.Sprintf("Failed to fetch news for topic %s: %v", topic, err),
			})
		}

		var stored, updated, skipped int
		for index, article := range articles {
			if index >= 5 {
				break
			}
			link := article.ArticleURL()
			title := strings.TrimSpace(article.Title)
			if link == "" || title == "" {
				skipped++
				continue
			}

			textBody := buildArticleText(article)

			var existing models.NewsModel
			err := db.WithContext(ctx).Where("link = ?", link).First(&existing).Error
			if err == nil {
				objectUUID := existing.HashVal
				if objectUUID == uuid.Nil {
					objectUUID, err = uuid.NewRandom()
					if err != nil {
						return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
							"error": fmt.Sprintf("Failed to generate UUID for existing article on topic %s: %v", topic, err),
						})
					}
					existing.HashVal = objectUUID
				}

				objectKey := fmt.Sprintf("%s:%s.txt", tag, objectUUID.String())

				if err := uploadArticleText(ctx, s3Client, bucket, objectKey, textBody); err != nil {
					return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
						"error": fmt.Sprintf("Failed to upload article for topic %s: %v", topic, err),
					})
				}

				presigned, err := presignClient.PresignGetObject(ctx, &s3.GetObjectInput{
					Bucket: aws.String(bucket),
					Key:    aws.String(objectKey),
				}, func(opts *s3.PresignOptions) {
					opts.Expires = presignTTL
				})
				if err != nil {
					return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
						"error": fmt.Sprintf("Failed to generate presigned URL for topic %s: %v", topic, err),
					})
				}

				existing.Title = title
				existing.Description = article.Description
				existing.ImageURL = article.ImageLink()
				existing.Author = article.PrimaryAuthor()
				existing.Tags = tag
				existing.S3Url = presigned.URL

				if err := db.WithContext(ctx).Save(&existing).Error; err != nil {
					return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
						"error": fmt.Sprintf("Failed to update article for topic %s: %v", topic, err),
					})
				}

				updated++
				continue
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": fmt.Sprintf("DB lookup failed for topic %s: %v", topic, err),
				})
			}

			fileUUID, err := uuid.NewRandom()
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": fmt.Sprintf("Failed to generate UUID for topic %s: %v", topic, err),
				})
			}

			objectKey := fmt.Sprintf("%s:%s.txt", tag, fileUUID.String())

			if err := uploadArticleText(ctx, s3Client, bucket, objectKey, textBody); err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": fmt.Sprintf("Failed to upload article for topic %s: %v", topic, err),
				})
			}

			presigned, err := presignClient.PresignGetObject(ctx, &s3.GetObjectInput{
				Bucket: aws.String(bucket),
				Key:    aws.String(objectKey),
			}, func(opts *s3.PresignOptions) {
				opts.Expires = presignTTL
			})
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": fmt.Sprintf("Failed to generate presigned URL for topic %s: %v", topic, err),
				})
			}

			record := models.NewsModel{
				Title:       title,
				Description: article.Description,
				Link:        link,
				ImageURL:    article.ImageLink(),
				Author:      article.PrimaryAuthor(),
				Tags:        tag,
				HashVal:     fileUUID,
				S3Url:       presigned.URL,
				Bias:        0,
			}

			if err := db.WithContext(ctx).Create(&record).Error; err != nil {
				if errors.Is(err, gorm.ErrDuplicatedKey) {
					var duplicate models.NewsModel
					if lookupErr := db.WithContext(ctx).Where("link = ?", link).First(&duplicate).Error; lookupErr != nil {
						return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
							"error": fmt.Sprintf("Failed to load existing duplicate for topic %s: %v", topic, lookupErr),
						})
					}

					duplicate.Title = title
					duplicate.Description = article.Description
					duplicate.ImageURL = article.ImageLink()
					duplicate.Author = article.PrimaryAuthor()
					duplicate.Tags = tag
					duplicate.HashVal = fileUUID
					duplicate.S3Url = presigned.URL

					if saveErr := db.WithContext(ctx).Save(&duplicate).Error; saveErr != nil {
						return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
							"error": fmt.Sprintf("Failed to update duplicate article for topic %s: %v", topic, saveErr),
						})
					}

					updated++
					continue
				}
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": fmt.Sprintf("Failed to store article for topic %s: %v", topic, err),
				})
			}
			stored++
		}

		results[tag] = topicSummary{
			Stored:  stored,
			Updated: updated,
			Skipped: skipped,
		}
	}

	return c.JSON(fiber.Map{
		"message": "News fetched and stored successfully",
		"summary": results,
	})
}
