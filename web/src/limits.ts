// Text limits; the same numbers are set on the fields in internal/migrations.
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
} as const;
