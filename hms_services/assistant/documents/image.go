package documents

import (
	"bytes"
	"image"
	"image/jpeg"
	"image/png"
)

// ReencodeImage decodes an image and encodes it again, which drops all metadata (EXIF, GPS location, comments) and any
// bytes that are not image data. The pixel size is checked from the header before the image is decoded.
func ReencodeImage(b []byte, mediaType string) ([]byte, error) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(b))
	if err != nil {
		return nil, reject(RejectUnreadable)
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width > MaxImageSide || cfg.Height > MaxImageSide ||
		cfg.Width*cfg.Height > MaxImagePixels {
		return nil, reject(RejectImageTooLarge)
	}
	img, _, err := image.Decode(bytes.NewReader(b))
	if err != nil {
		return nil, reject(RejectUnreadable)
	}
	var out bytes.Buffer
	switch mediaType {
	case TypeJPEG:
		err = jpeg.Encode(&out, img, &jpeg.Options{Quality: 90})
	case TypePNG:
		err = png.Encode(&out, img)
	default:
		return nil, reject(RejectUnsupported)
	}
	if err != nil {
		return nil, reject(RejectUnreadable)
	}
	if out.Len() > MaxFileBytes {
		return nil, reject(RejectTooLarge)
	}
	return out.Bytes(), nil
}
