package bot

import (
	"fmt"
	"html"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// texts are the words of the messages; "who" is a label, so no verb has to agree with anyone's gender.
type texts struct {
	assigned, added, comment, file, due, status, who string
	statusTitle, statusName                          map[string]string
	months                                           [12]string
}

var words = map[string]texts{
	"ru": {
		assigned: "Вам назначена задача", added: "Вас добавили в проект", comment: "Новый комментарий", file: "📎 файл", due: "Срок:", status: "Статус:", who: "Кто:",
		statusTitle: map[string]string{
			"backlog": "Задача перенесена в «Бэклог»", "todo": "Задача перенесена в «К работе»", "in_progress": "Задача взята в работу",
			"review": "Задача на проверке", "done": "Задача выполнена",
		},
		statusName: map[string]string{
			"backlog": "Бэклог", "todo": "К работе", "in_progress": "В работе", "review": "На проверке", "done": "Готово",
		},
		months: [12]string{"января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"},
	},
	"en": {
		assigned: "You've been assigned a task", added: "You've been added to a project", comment: "New comment", file: "📎 file", due: "Due:", status: "Status:", who: "By:",
		statusTitle: map[string]string{
			"backlog": `Task moved to "Backlog"`, "todo": `Task moved to "Todo"`, "in_progress": "Task started",
			"review": "Task in review", "done": "Task done",
		},
		statusName: map[string]string{
			"backlog": "Backlog", "todo": "Todo", "in_progress": "In progress", "review": "In review", "done": "Done",
		},
		months: [12]string{"January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"},
	},
}

var statusMark = map[string]string{
	"backlog": "⚪", "todo": "⚪", "in_progress": "🔵", "review": "🟣", "done": "🟢",
}

func assignedMessage(lang, publicURL string, task, project *core.Record, by string) string {
	w := words[lang]
	var lines []string
	if due := task.GetString("due"); due != "" {
		lines = append(lines, label(w.due, day(due, w)))
	}
	return message("📌", w.assigned, taskHead(publicURL, task, project), append(lines, who(w, by)...))
}

func statusMessage(lang, publicURL string, task, project *core.Record, oldStatus, by string) string {
	w := words[lang]
	status := task.GetString("status")
	change := w.statusName[oldStatus] + " → " + w.statusName[status]
	return message(statusMark[status], w.statusTitle[status], taskHead(publicURL, task, project),
		append([]string{label(w.status, change)}, who(w, by)...))
}

func addedMessage(lang, publicURL string, project *core.Record, by string) string {
	w := words[lang]
	key := project.GetString("key")
	head := fmt.Sprintf(`<a href="%s/p/%s"><b>%s</b></a> · %s`, publicURL, strings.ToLower(key),
		html.EscapeString(project.GetString("name")), key)
	return message("📁", w.added, head, who(w, by))
}

// A few lines of the comment; the rest is one tap away in the task.
const quoteLen = 300

func commentMessage(lang, publicURL string, task, project *core.Record, by, body string) string {
	var lines []string
	if by != "" {
		lines = append(lines, "<b>"+html.EscapeString(by)+":</b>")
	}
	quote := plain(body)
	if quote == "" {
		quote = strings.TrimSpace(body)
	}
	// Files come after the comment (internal/tasks/attachments.go), so there is no count to give yet.
	if quote == "" {
		quote = words[lang].file
	}
	lines = append(lines, "<blockquote>"+html.EscapeString(cut(quote, quoteLen))+"</blockquote>")
	return message("💬", words[lang].comment, taskHead(publicURL, task, project), lines)
}

// The comment goes as plain text: Markdown marks are dropped, everything the person wrote stays, so `#` and
// `>` go only where they start a line. Go's regexp has no lookahead, hence two underscore rules.
var markdown = []struct {
	re *regexp.Regexp
	to string
}{
	{regexp.MustCompile(`!?\[([^\]]*)\]\([^)]*\)`), "$1"},
	{regexp.MustCompile(`(?m)^[ \t]*([-+*]|#{1,6}|>+)[ \t]+(\[[ xX]\][ \t]+)?`), ""},
	{regexp.MustCompile("[*`~]"), ""},
	{regexp.MustCompile(`(^|[^\p{L}\p{N}_])_+`), "$1"},
	{regexp.MustCompile(`_+([^\p{L}\p{N}_]|$)`), "$1"},
	{regexp.MustCompile(`\n{3,}`), "\n\n"},
}

func plain(body string) string {
	for _, r := range markdown {
		body = r.re.ReplaceAllString(body, r.to)
	}
	return strings.TrimSpace(body)
}

func cut(text string, limit int) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	head := string(runes[:limit])
	if i := strings.LastIndexAny(head, " \n"); i > len(head)/2 {
		head = head[:i]
	}
	return strings.TrimRight(head, " \n.,;:") + "…"
}

func taskHead(publicURL string, task, project *core.Record) string {
	key := project.GetString("key")
	number := strconv.Itoa(task.GetInt("number"))
	return fmt.Sprintf(`<a href="%s/p/%s/%s"><b>%s</b></a>`+"\n%s-%s · %s",
		publicURL, strings.ToLower(key), number, html.EscapeString(task.GetString("title")),
		key, number, html.EscapeString(project.GetString("name")))
}

func message(mark, title, head string, lines []string) string {
	text := mark + " <b>" + html.EscapeString(title) + "</b>\n\n" + head
	if len(lines) > 0 {
		text += "\n\n" + strings.Join(lines, "\n")
	}
	return text
}

func who(w texts, by string) []string {
	if by == "" {
		return nil
	}
	return []string{label(w.who, by)}
}

func label(name, value string) string {
	return "<b>" + html.EscapeString(name) + "</b> " + html.EscapeString(value)
}

func day(due string, w texts) string {
	t, err := time.Parse(time.DateOnly, due)
	if err != nil {
		return due
	}
	return strconv.Itoa(t.Day()) + " " + w.months[t.Month()-1]
}
