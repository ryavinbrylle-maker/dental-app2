// Shared rules for student codes (M-1, F-2, ...).
// Files starting with "_" are not turned into web addresses by Vercel.

export const MAX_CODE_NUMBER = 999;

// Returns { gender, number } or { error }
export function checkCode(gender, number) {
  const g = String(gender || "").trim().toUpperCase();
  if (g !== "M" && g !== "F") {
    return { error: "Student code must start with M (Male) or F (Female)" };
  }
  const raw = String(number === undefined || number === null ? "" : number).trim();
  if (!/^[0-9]+$/.test(raw)) {
    return { error: "Student code number must be a whole number like 1, 2, 3" };
  }
  const n = parseInt(raw, 10);
  if (n < 1 || n > MAX_CODE_NUMBER) {
    return { error: "Student code number must be between 1 and " + MAX_CODE_NUMBER };
  }
  return { gender: g, number: n };
}

export function codeLabel(gender, number) {
  return gender + "-" + number;
}

export function sexFromCode(gender) {
  return gender === "M" ? "Male" : "Female";
}

// Postgres "unique violation" error
export function isDuplicateError(err) {
  return err && (err.code === "23505" || /students_code_unique/.test(String(err.message)));
}

export function duplicateMessage(grade, section, gender, number) {
  return "Code " + codeLabel(gender, number) + " is already used in " + grade + " – " + section +
         ". Please check the number with your teacher.";
}
