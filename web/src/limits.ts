// Field limits; the same numbers are set on the fields in internal/migrations.
export const LIMITS = {
  projectName: 60,
  projectDescription: 500,
  taskTitle: 200,
  taskDescription: 20000,
  noteTitle: 120,
  noteBody: 50000,
  labelName: 24,
  tokenName: 40,
  comment: 5000,
  assignees: 10,
  reviewers: 10,
  attachmentSize: 50 * 1024 * 1024,
  attachmentsPerComment: 10,
  projectIconSize: 5 * 1024 * 1024,
} as const;

// By the name, as a picker may give no type for webp; the server checks the content against the icon
// field's types in internal/migrations.
export const PROJECT_ICON_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];
