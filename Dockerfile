# syntax=docker/dockerfile:1.6
# Multi-stage build for the @starnose/dashboard Next.js app.
# Produces a small standalone image suitable for Cloud Run.

ARG NODE_VERSION=20-alpine

# ── deps ──────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /repo

# Copy lockfile + workspace manifests so npm can resolve workspaces.
COPY package.json package-lock.json ./
COPY packages/dashboard/package.json ./packages/dashboard/package.json
# We don't need other workspaces' source for the dashboard build,
# but their package.json must exist so npm install doesn't fail.
COPY packages/cli/package.json ./packages/cli/package.json
COPY packages/proxy/package.json ./packages/proxy/package.json

# Install only what the dashboard workspace needs.
RUN npm install --workspace=@starnose/dashboard --include-workspace-root=false --no-audit --no-fund

# ── build ─────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages/dashboard ./packages/dashboard

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace=@starnose/dashboard

# ── runtime ───────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV WAITLIST_BACKEND=firestore
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

# Standalone server bundle (includes minimal node_modules).
COPY --from=build --chown=nextjs:nodejs /repo/packages/dashboard/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /repo/packages/dashboard/.next/static ./packages/dashboard/.next/static
COPY --from=build --chown=nextjs:nodejs /repo/packages/dashboard/public ./packages/dashboard/public

USER nextjs
EXPOSE 8080
CMD ["node", "packages/dashboard/server.js"]
