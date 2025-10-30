package models

import "github.com/google/uuid"

type NewsModel struct {
	BaseModel
	Title       string    `gorm:"type:varchar(255)" json:"title"`
	Description string    `gorm:"type:text" json:"description"`
	Link        string    `gorm:"type:varchar(255);unique" json:"link"`
	ImageURL    string    `gorm:"type:varchar(255)" json:"image_url"`
	Author      string    `gorm:"type:varchar(255)" json:"author"`
	Tags        string    `gorm:"type:varchar(255)" json:"tags"`
	HashVal     uuid.UUID `gorm:"type:uuid" json:"hash_val"`
	Bias        float64   `json:"bias"`
}
