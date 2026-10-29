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
  attachmentSize: 50 * 1024 * 1024,
  attachmentsPerComment: 10,
} as const;

// What a file picker offers; the server checks the content against attachmentTypes in internal/migrations.
export const ATTACHMENT_EXTENSIONS = (
  "png jpg jpeg gif webp heic heif pdf txt log md csv json docx xlsx pptx odt ods zip gz tgz " +
  "mp4 mov webm mp3 wav m4a"
).split(" ");
