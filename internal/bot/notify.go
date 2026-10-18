package bot

import (
	"slices"

	"github.com/pocketbase/pocketbase/core"

	"github.com/nessshon/myboard/internal/apitoken"
)

const (
	kindAssigned = "assigned"
	kindStatus   = "status"
	kindAdded    = "added"
)

func (b *Bot) bindEvents() {
	b.app.OnRecordCreateRequest("tasks").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		b.taskChanged(e, "", e.Record.GetString("status"))
		return nil
	})

	b.app.OnRecordUpdateRequest("tasks").BindFunc(func(e *core.RecordRequestEvent) error {
		before := e.Record.Original()
		assignee, status := before.GetString("assignee"), before.GetString("status")
		if err := e.Next(); err != nil {
			return err
		}
		b.taskChanged(e, assignee, status)
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

func (b *Bot) taskChanged(e *core.RecordRequestEvent, oldAssignee, oldStatus string) {
	task := e.Record
	project, err := b.app.FindRecordById("projects", task.GetString("project"))
	if err != nil {
		b.app.Logger().Warn("notify: find project", "task", task.Id, "error", err)
		return
	}
	by := actor(e)

	assigned := task.GetString("assignee")
	if assigned == oldAssignee || assigned == authID(e) {
		assigned = ""
	}
	if user := b.recipient(assigned, kindAssigned, project); user != nil {
		b.enqueue(user, assignedMessage(lang(user), b.publicURL, task, project, by))
	}

	status := task.GetString("status")
	if status == oldStatus {
		return
	}
	for _, id := range slices.Compact([]string{task.GetString("author"), task.GetString("assignee")}) {
		if id == authID(e) || id == assigned {
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
	if e.Auth == nil {
		return ""
	}
	name := e.Auth.GetString("name")
	if name == "" {
		name = e.Auth.GetString("username")
	}
	if apitoken.ViaToken(e.RequestEvent) {
		name += " (API)"
	}
	return name
}

func lang(user *core.Record) string {
	if user.GetString("lang") == "en" {
		return "en"
	}
	return "ru"
}
