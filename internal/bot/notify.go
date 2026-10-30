package bot

import (
	"regexp"
	"slices"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/list"

	"github.com/nessshon/myboard/internal/apitoken"
)

// Kinds in users.notify_off. Being added to a project counts as an assignment.
const (
	kindAssigned = "assigned"
	kindStatus   = "status"
	kindComment  = "comment"
)

func (b *Bot) bindEvents() {
	b.app.OnRecordCreateRequest("tasks").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		b.taskChanged(e, nil)
		return nil
	})

	b.app.OnRecordUpdateRequest("tasks").BindFunc(func(e *core.RecordRequestEvent) error {
		before := e.Record.Original().Clone()
		if err := e.Next(); err != nil {
			return err
		}
		b.taskChanged(e, before)
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
			if user := b.recipient(id, kindAssigned, project); user != nil {
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
	people := participants(task)
	for _, c := range thread {
		people = append(people, c.GetString("author"))
	}
	body := mention.ReplaceAllStringFunc(comment.GetString("body"), func(link string) string {
		id := mention.FindStringSubmatch(link)[1]
		people = append(people, id)
		if user, err := b.app.FindRecordById("users", id); err == nil {
			return "@" + userName(user)
		}
		return link
	})
	by := name(e) // no "(API)": a comment is signed by its person, as it is shown on the site
	for i, id := range people {
		if id == authID(e) || slices.Contains(people[:i], id) {
			continue
		}
		if user := b.recipient(id, kindComment, project); user != nil {
			b.enqueue(user, commentMessage(lang(user), b.publicURL, task, project, by, body))
		}
	}
}

// One save sends a person one message at most, the weightiest for them: made an assignee, else made a reviewer, else
// the status moved. A new task has no status change to tell (before is nil).
func (b *Bot) taskChanged(e *core.RecordRequestEvent, before *core.Record) {
	task := e.Record
	project, err := b.app.FindRecordById("projects", task.GetString("project"))
	if err != nil {
		b.app.Logger().Warn("notify: find project", "task", task.Id, "error", err)
		return
	}
	by := actor(e)
	was := func(field string) []string {
		if before == nil {
			return nil
		}
		return before.GetStringSlice(field)
	}

	assigned := joined(e, task.GetStringSlice("assignees"), was("assignees"))
	for _, id := range assigned {
		if user := b.recipient(id, kindAssigned, project); user != nil {
			b.enqueue(user, assignedMessage(lang(user), b.publicURL, task, project, by))
		}
	}
	var reviewing []string
	for _, id := range joined(e, task.GetStringSlice("reviewers"), was("reviewers")) {
		if slices.Contains(task.GetStringSlice("assignees"), id) {
			continue
		}
		reviewing = append(reviewing, id)
		if user := b.recipient(id, kindAssigned, project); user != nil {
			b.enqueue(user, reviewerMessage(lang(user), b.publicURL, task, project, by))
		}
	}

	if before == nil || task.GetString("status") == before.GetString("status") {
		return
	}
	reviewers := b.reviewerNames(task)
	for _, id := range participants(task) {
		if id == authID(e) || slices.Contains(assigned, id) || slices.Contains(reviewing, id) {
			continue
		}
		if user := b.recipient(id, kindStatus, project); user != nil {
			b.enqueue(user, statusMessage(lang(user), b.publicURL, task, project, before.GetString("status"), by, reviewers))
		}
	}
}

// Shown only once the task is in review, in the order they were picked.
func (b *Bot) reviewerNames(task *core.Record) []string {
	if task.GetString("status") != "review" {
		return nil
	}
	var names []string
	for _, id := range task.GetStringSlice("reviewers") {
		if user, err := b.app.FindRecordById("users", id); err == nil {
			names = append(names, userName(user))
		}
	}
	return names
}

func participants(task *core.Record) []string {
	people := append([]string{task.GetString("author")}, task.GetStringSlice("assignees")...)
	return list.NonzeroUniques(append(people, task.GetStringSlice("reviewers")...))
}

// Whoever saved is not told about their own change.
func joined(e *core.RecordRequestEvent, now, was []string) []string {
	var ids []string
	for _, id := range now {
		if !slices.Contains(was, id) && id != authID(e) {
			ids = append(ids, id)
		}
	}
	return ids
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

// The web app turns a picked "@Name" into this link (web/src/components/Markdown.tsx); the id decides,
// the link text may be stale or made up.
var mention = regexp.MustCompile(`\[@[^\]\n]*\]\(user:([a-z0-9]{15})\)`)

func name(e *core.RecordRequestEvent) string {
	if e.Auth == nil {
		return ""
	}
	return userName(e.Auth)
}

func userName(user *core.Record) string {
	if n := user.GetString("name"); n != "" {
		return n
	}
	return user.GetString("username")
}

func lang(user *core.Record) string {
	if user.GetString("lang") == "en" {
		return "en"
	}
	return "ru"
}
