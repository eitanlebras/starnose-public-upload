FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY landing.html /usr/share/nginx/html/index.html
COPY logo-mauve.png /usr/share/nginx/html/logo-mauve.png
COPY logo-mauve.html /usr/share/nginx/html/logo-mauve.html
EXPOSE 8080
