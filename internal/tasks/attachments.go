package tasks

import (
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"syscall"

	"github.com/gabriel-vasile/mimetype"
	validation "github.com/pocketbase/ozzo-validation/v4"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

// A full disk stops every SQLite write, sign-in included, so a file is refused while it would leave less.
const minFreeDisk = 1 << 30

// Besides any text: pictures, documents, archives and media, told by the content as PocketBase tells it.
var attachmentFormats = []string{
	"image/png", "image/jpeg", "image/gif", "image/webp", "image/heic", "image/heif",
	"application/pdf",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"application/vnd.oasis.opendocument.text", "application/vnd.oasis.opendocument.spreadsheet",
	"application/zip", "application/gzip",
	"video/mp4", "video/quicktime", "video/webm",
	"audio/mpeg", "audio/wav", "audio/mp4", "audio/x-m4a",
}

// A page or an SVG runs a script once opened. Refused by the name, as by the content a README that opens with
// a tag is HTML too.
var refusedExtensions = []string{".html", ".htm", ".xhtml", ".xht", ".svg"}

func registerAttachments(app core.App) {
	// The name on disk loses Cyrillic (tools/filesystem/file.go), so the one the file came with is kept for
	// display and downloads; the size is the file's own, not what the client says.
	app.OnRecordCreateRequest("attachments").BindFunc(func(e *core.RecordRequestEvent) error {
		files := e.Record.GetUnsavedFiles("file")
		if len(files) != 1 {
			return e.Next()
		}
		f := files[0]
		var disk syscall.Statfs_t
		if err := syscall.Statfs(e.App.DataDir(), &disk); err != nil {
			return fmt.Errorf("check free disk space: %w", err)
		}
		if uint64(disk.Bavail)*uint64(disk.Bsize) < minFreeDisk+uint64(f.Size) {
			return e.BadRequestError("Not enough free disk space.", nil)
		}
		name := []rune(f.OriginalName)
		e.Record.Set("name", string(name[:min(len(name), 255)]))
		e.Record.Set("size", f.Size)
		return e.Next()
	})

	app.OnRecordValidate("attachments").BindFunc(func(e *core.RecordEvent) error {
		for _, f := range e.Record.GetUnsavedFiles("file") {
			ok, err := attachable(f)
			if err != nil {
				return err
			}
			if !ok {
				// PocketBase's own code for a refused type, so clients tell it as before.
				return validation.Errors{"file": validation.NewError("validation_invalid_mime_type", "This type of file cannot be attached.")}
			}
		}
		return e.Next()
	})

	app.OnFileDownloadRequest("attachments").BindFunc(func(e *core.FileDownloadRequestEvent) error {
		// Thumbs are served under their own names.
		if e.ServedName == e.Record.GetString("file") {
			e.ServedName = e.Record.GetString("name")
		}
		return e.Next()
	})
}

func attachable(f *filesystem.File) (bool, error) {
	// The stored name: PocketBase cleans its extension, so "page.html " ends in .html.
	if slices.Contains(refusedExtensions, strings.ToLower(filepath.Ext(f.Name))) {
		return false, nil
	}
	r, err := f.Reader.Open()
	if err != nil {
		return false, fmt.Errorf("open the attachment: %w", err)
	}
	defer r.Close()
	kind, err := mimetype.DetectReader(r)
	if err != nil {
		return false, fmt.Errorf("tell the attachment's type: %w", err)
	}
	// Code, configs, patches and logs are text/plain or grow from it: text/x-python, text/x-shellscript and so on.
	for t := kind; t != nil; t = t.Parent() {
		if t.Is("text/plain") {
			return true, nil
		}
	}
	return slices.ContainsFunc(attachmentFormats, kind.Is), nil
}
