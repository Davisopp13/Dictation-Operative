export function GET(request: Request) {
  return Response.redirect(new URL('/testing-checklist-interactive.html', request.url), 307);
}
