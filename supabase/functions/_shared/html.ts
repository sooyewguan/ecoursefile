// The HTML of emails. Every value that a user wrote, such as a name, a course title or a comment,
// goes into an email through escapeHtml, so it shows as text and never as markup.

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character])
}
