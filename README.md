# Reddit Thread to Markdown Converter

A web app that converts Reddit threads into clean Markdown format. Paste a URL, get structured Markdown with nested comments preserved.

Forked from [frankwiersma/reddit2markdown](https://github.com/frankwiersma/reddit2markdown) with added support for nested comment parsing.

## Features

- Paste any Reddit thread URL and get Markdown output instantly
- Nested comments rendered with proper hierarchy using blockquotes
- Toggle between rendered and raw Markdown views
- One-click copy to clipboard
- No API keys required — uses Reddit's public `.json` endpoint

## Tech Stack

- React 18 + TypeScript
- Vite
- Tailwind CSS

## Local Development

```bash
npm install
npm run dev
```

## Docker Deployment

The app is containerized with a multi-stage build (Node for building, nginx for serving).

Build and run locally:

```bash
docker compose up -d --build
```

The app will be available at `http://localhost:8080`.

To stop:

```bash
docker compose down
```
