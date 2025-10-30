package models

type NewsModel struct {
	BaseModel
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Link        string  `json:"link" gorm:"unique"`
	ImageURL    string  `json:"image_url"`
	Author      string  `json:"author"`
	Tags        string  `json:"tags"`
	HashVal     string  `json:"hash_val"`
	Bias        float64 `json:"bias"`
}
