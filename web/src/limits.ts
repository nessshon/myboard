// Text limits; the same numbers are set on the fields in internal/migrations/1760572800_init.go.
export const LIMITS = {
  projectName: 60,
  projectDescription: 500,
  taskTitle: 200,
  taskDescription: 20000,
  noteTitle: 120,
  noteBody: 50000,
  labelName: 24,
  tokenName: 40,
} as const;
