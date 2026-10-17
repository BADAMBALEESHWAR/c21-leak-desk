// CloudFront Function (viewer request): the site is three static pages in a private S3 bucket.
// "/" is the landing page, "/login/" the sign-in page and "/app/" the app; each folder serves its index.html.
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri === '/app' || uri === '/login') {
    return { statusCode: 301, statusDescription: 'Moved Permanently', headers: { location: { value: uri + '/' } } };
  }
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  }
  return request;
}
