package bot

import (
	"slices"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/nessshon/myboard/internal/apitoken"
)

const (
	kindAssigned = "assigned"
	kindStatus   = "status"
	kindAdded    = "added"
	kindComment  = "comment"
)

func (b *Bot) bindEvents() {
	b.app.OnRecordCreateRequest("tasks").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		b.taskChanged(e, nil, e.Record.GetString("status"))
		return nil
	})

	b.app.OnRecordUpdateRequest("tasks").BindFunc(func(e *core.RecordRequestEvent) error {
		before := e.Record.Original()
		assignees, status := before.GetStringSlice("assignees"), before.GetString("status")
		if err := e.Next(); err != nil {
			return err
		}
		b.taskChanged(e, assignees, status)
		return nil
	})

	b.app.OnRecordCreateRequest("comments").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		b.commented(e)
		return nil
	})

	b.app.OnRecordUpdateRequest("projects").BindFunc(func(e *core.RecordRequestEvent) error {
		members := e.Record.Original().GetStringSlice("members")
		if err := e.Next(); err != nil {
			return err
		}
		project := e.Record
		by := actor(e)
		for _, id := range project.GetStringSlice("members") {
			if slices.Contains(members, id) || id == authID(e) {
				continue
			}
			if user := b.recipient(id, kindAdded, project); user != nil {
				b.enqueue(user, addedMessage(lang(user), b.publicURL, project, by))
			}
		}
		return nil
	})
}

func (b *Bot) commented(e *core.RecordRequestEvent) {
	comment := e.Record
	task, err := b.app.FindRecordById("tasks", comment.GetString("task"))
	if err != nil {
		b.app.Logger().Warn("notify: find task", "comment", comment.Id, "error", err)
		return
	}
	project, err := b.app.FindRecordById("projects", task.GetString("project"))
	if err != nil {
		b.app.Logger().Warn("notify: find project", "task", task.Id, "error", err)
		return
	}
	thread, err := b.app.FindAllRecords("comments", dbx.HashExp{"task": task.Id})
	if err != nil {
		b.app.Logger().Warn("notify: find comments", "task", task.Id, "error", err)
		return
	}
	people := append([]string{task.GetString("author")}, task.GetStringSlice("assignees")...)
	for _, c := range thread {
		people = append(people, c.GetString("author"))
	}
	by := name(e) // no "(API)": a comment is signed by its person, as it is shown on the site
	for i, id := range people {
		if id == authID(e) || slices.Contains(people[:i], id) {
			continue
		}
		if user := b.recipient(id, kindComment, project); user != nil {
			b.enqueue(user, commentMessage(lang(user), b.publicURL, task, project, by, comment.GetString("body")))
		}
	}
}

func (b *Bot) taskChanged(e *core.RecordRequestEvent, oldAssignees []string, oldStatus string) {
	task := e.Record
	project, err := b.app.FindRecordById("projects", task.GetString("project"))
	if err != nil {
		b.app.Logger().Warn("notify: find project", "task", task.Id, "error", err)
		return
	}
	by := actor(e)

	var assigned []string
	for _, id := range task.GetStringSlice("assignees") {
		if slices.Contains(oldAssignees, id) || id == authID(e) {
			continue
		}
		assigned = append(assigned, id)
		if user := b.recipient(id, kindAssigned, project); user != nil {
			b.enqueue(user, assignedMessage(lang(user), b.publicURL, task, project, by))
		}
	}

	status := task.GetString("status")
	if status == oldStatus {
		return
	}
	people := append([]string{task.GetString("author")}, task.GetStringSlice("assignees")...)
	for i, id := range people {
		if id == authID(e) || slices.Contains(assigned, id) || slices.Contains(people[:i], id) {
			continue
		}
		if user := b.recipient(id, kindStatus, project); user != nil {
			b.enqueue(user, statusMessage(lang(user), b.publicURL, task, project, oldStatus, by))
		}
	}
}

func (b *Bot) recipient(id, kind string, project *core.Record) *core.Record {
	if id == "" {
		return nil
	}
	user, err := b.app.FindRecordById("users", id)
	if err != nil || user.GetBool("deleted") || user.GetBool("bot_blocked") || user.GetString("tg_id") == "" {
		return nil
	}
	if slices.Contains(user.GetStringSlice("notify_off"), kind) {
		return nil
	}
	if user.GetString("role") != "admin" && !slices.Contains(project.GetStringSlice("members"), id) {
		return nil
	}
	return user
}

func authID(e *core.RecordRequestEvent) string {
	if e.Auth == nil {
		return ""
	}
	return e.Auth.Id
}

func actor(e *core.RecordRequestEvent) string {
	by := name(e)
	if by != "" && apitoken.ViaToken(e.RequestEvent) {
		by += " (API)"
	}
	return by
}

func name(e *core.RecordRequestEvent) string {
	if e.Auth == nil {
		return ""
	}
	if n := e.Auth.GetString("name"); n != "" {
		return n
	}
	return e.Auth.GetString("username")
}

func lang(user *core.Record) string {
	if user.GetString("lang") == "en" {
		return "en"
	}
	return "ru"
}
