package tasks

import (
	"fmt"
	"syscall"

	"github.com/pocketbase/pocketbase/core"
)

// A full disk stops every SQLite write, sign-in included, so a file is refused while it would leave less.
const minFreeDisk = 1 << 30

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

	app.OnFileDownloadRequest("attachments").BindFunc(func(e *core.FileDownloadRequestEvent) error {
		// Thumbs are served under their own names.
		if e.ServedName == e.Record.GetString("file") {
			e.ServedName = e.Record.GetString("name")
		}
		return e.Next()
	})
}
