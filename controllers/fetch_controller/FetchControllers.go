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

const (
	defaultPresignTTL   = 24 * time.Hour
	maxArticlesPerTopic = 5
)

type TopicSummary struct {
	Stored  int `json:"stored"`
	Updated int `json:"updated"`
	Skipped int `json:"skipped"`
}

type WorkflowConfig struct {
	APIKey      string
	Bucket      string
	Region      string
	PresignTTL  time.Duration
	MaxArticles int
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

func LoadWorkflowConfigFromEnv() (WorkflowConfig, error) {
	cfg := WorkflowConfig{
		APIKey:      strings.TrimSpace(os.Getenv("NEWS_API_KEY")),
		Bucket:      strings.TrimSpace(os.Getenv("AWS_S3_BUCKET")),
		Region:      strings.TrimSpace(os.Getenv("AWS_REGION")),
		PresignTTL:  defaultPresignTTL,
		MaxArticles: maxArticlesPerTopic,
	}

	if ttlStr := strings.TrimSpace(os.Getenv("S3_PRESIGN_TTL")); ttlStr != "" {
		if ttl, err := time.ParseDuration(ttlStr); err == nil && ttl > 0 {
			cfg.PresignTTL = ttl
		}
	}

	if cfg.APIKey == "" {
		return cfg, errors.New("NEWS_API_KEY must be set")
	}
	if cfg.Bucket == "" || cfg.Region == "" {
		return cfg, errors.New("AWS_S3_BUCKET and AWS_REGION must be set")
	}
	if cfg.MaxArticles <= 0 {
		cfg.MaxArticles = maxArticlesPerTopic
	}

	return cfg, nil
}

func FetchTopicsWithConfig(ctx context.Context, topicList []string, cfg WorkflowConfig) (map[string]TopicSummary, error) {
	if len(topicList) == 0 {
		return map[string]TopicSummary{}, nil
	}

	db := initializer.Database.Db
	if db == nil {
		return nil, errors.New("database connection unavailable")
	}

	awsCfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(cfg.Region))
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %w", err)
	}

	s3Client := s3.NewFromConfig(awsCfg)
	presignClient := s3.NewPresignClient(s3Client)

	results := make(map[string]TopicSummary)
	for _, topic := range topicList {
		summary, err := fetchTopic(ctx, db, s3Client, presignClient, cfg, topic)
		if err != nil {
			return nil, err
		}
		tag := strings.ToLower(strings.TrimSpace(topic))
		if tag == "" {
			continue
		}
		results[tag] = summary
	}

	return results, nil
}

func fetchTopic(ctx context.Context, db *gorm.DB, s3Client *s3.Client, presignClient *s3.PresignClient, cfg WorkflowConfig, topic string) (TopicSummary, error) {
	var summary TopicSummary
	trimmed := strings.TrimSpace(topic)
	if trimmed == "" {
		return summary, fmt.Errorf("topic cannot be empty")
	}

	topicCtx, cancelTopic := context.WithTimeout(ctx, 20*time.Second)
	articles, err := FetchNewsFromAPI(topicCtx, trimmed, cfg.APIKey)
	cancelTopic()
	if err != nil {
		return summary, fmt.Errorf("failed to fetch news for topic %s: %w", trimmed, err)
	}

	tag := strings.ToLower(trimmed)
	for index, article := range articles {
		if cfg.MaxArticles > 0 && index >= cfg.MaxArticles {
			break
		}

		link := article.ArticleURL()
		title := strings.TrimSpace(article.Title)
		if link == "" || title == "" {
			summary.Skipped++
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
					return summary, fmt.Errorf("failed to generate UUID for existing article on topic %s: %w", trimmed, err)
				}
				existing.HashVal = objectUUID
			}

			objectKey := fmt.Sprintf("%s:%s.txt", tag, objectUUID.String())

			if err := uploadArticleText(ctx, s3Client, cfg.Bucket, objectKey, textBody); err != nil {
				return summary, fmt.Errorf("failed to upload article for topic %s: %w", trimmed, err)
			}

			presigned, err := presignClient.PresignGetObject(ctx, &s3.GetObjectInput{
				Bucket: aws.String(cfg.Bucket),
				Key:    aws.String(objectKey),
			}, func(opts *s3.PresignOptions) {
				opts.Expires = cfg.PresignTTL
			})
			if err != nil {
				return summary, fmt.Errorf("failed to generate presigned URL for topic %s: %w", trimmed, err)
			}

			existing.Title = title
			existing.Description = article.Description
			existing.ImageURL = article.ImageLink()
			existing.Author = article.PrimaryAuthor()
			existing.Tags = tag
			existing.S3Url = presigned.URL

			if err := db.WithContext(ctx).Save(&existing).Error; err != nil {
				return summary, fmt.Errorf("failed to update article for topic %s: %w", trimmed, err)
			}

			summary.Updated++
			continue
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return summary, fmt.Errorf("db lookup failed for topic %s: %w", trimmed, err)
		}

		fileUUID, err := uuid.NewRandom()
		if err != nil {
			return summary, fmt.Errorf("failed to generate UUID for topic %s: %w", trimmed, err)
		}

		objectKey := fmt.Sprintf("%s:%s.txt", tag, fileUUID.String())

		if err := uploadArticleText(ctx, s3Client, cfg.Bucket, objectKey, textBody); err != nil {
			return summary, fmt.Errorf("failed to upload article for topic %s: %w", trimmed, err)
		}

		presigned, err := presignClient.PresignGetObject(ctx, &s3.GetObjectInput{
			Bucket: aws.String(cfg.Bucket),
			Key:    aws.String(objectKey),
		}, func(opts *s3.PresignOptions) {
			opts.Expires = cfg.PresignTTL
		})
		if err != nil {
			return summary, fmt.Errorf("failed to generate presigned URL for topic %s: %w", trimmed, err)
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
					return summary, fmt.Errorf("failed to load existing duplicate for topic %s: %w", trimmed, lookupErr)
				}

				duplicate.Title = title
				duplicate.Description = article.Description
				duplicate.ImageURL = article.ImageLink()
				duplicate.Author = article.PrimaryAuthor()
				duplicate.Tags = tag
				duplicate.HashVal = fileUUID
				duplicate.S3Url = presigned.URL

				if saveErr := db.WithContext(ctx).Save(&duplicate).Error; saveErr != nil {
					return summary, fmt.Errorf("failed to update duplicate article for topic %s: %w", trimmed, saveErr)
				}

				summary.Updated++
				continue
			}
			return summary, fmt.Errorf("failed to store article for topic %s: %w", trimmed, err)
		}
		summary.Stored++
	}

	return summary, nil
}

func FetchNews(c *fiber.Ctx) error {
	cfg, err := LoadWorkflowConfigFromEnv()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	results, err := FetchTopicsWithConfig(ctx, topics, cfg)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"message": "News fetched and stored successfully",
		"summary": results,
	})
}
