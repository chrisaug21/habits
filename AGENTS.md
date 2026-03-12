# Agent Instructions — Habits

This document provides guidance for AI coding agents working in this repository (Codex, Claude Code, or similar tools).

Agents should read this file before making changes and follow the rules and conventions described here.

---


## Who I'm working with
I am a non-technical PM learning to vibe code. Explain everything in plain language — no jargon. When a technical term is unavoidable, explain it in one sentence.

# Project Overview

**Habits** is a lightweight habit-tracking web app designed to work as a **mobile-first Progressive Web App (PWA)**.

It is a solo-built personal app maintained by a non-technical product manager.

Primary goals:

- Simple, reliable habit tracking
- Fast mobile performance
- Offline capability via service worker
- Clean and minimal UI

The codebase is intentionally simple and avoids unnecessary frameworks.

Agents should prioritize:

- **small safe changes**
- preserving existing behavior
- maintaining simplicity

---

# Tech Stack

Frontend  
- HTML  
- CSS  
- Vanilla JavaScript  

Backend / data  
- Supabase  

Hosting  
- Netlify  

Architecture philosophy  
- minimal dependencies  
- simple readable code  
- predictable structure  

---

# Working Style

Agents must follow this workflow when making changes.

## Before editing code

1. Read **AGENTS.md** and **README.md**.
2. Briefly explain the planned change.
3. Identify which files will be modified.

## Editing rules

- Prefer the **smallest safe change** that solves the problem.
- Do not modify unrelated files.
- Preserve existing project conventions.
- Avoid unnecessary refactors.
- Do not introduce frameworks or major dependencies unless explicitly instructed.
- Never modify environment files or secrets.

## After editing

Always provide:

- a summary of changes
- list of modified files
- instructions for how to verify the change locally

---

# Code Principles

Keep the codebase:

- simple
- readable
- predictable

Prefer:

- straightforward logic
- clear naming
- minimal abstraction

Avoid:

- overengineering
- complex patterns
- unnecessary dependencies

---

# PWA + Service Worker Rules

This project uses a **service worker (`sw.js`)** to enable offline capability.

When modifying caching behavior or service worker logic:

- ensure cache versioning is handled correctly
- avoid breaking offline functionality
- test updates carefully
- confirm users will not get stuck on stale cached builds

Changes to service worker logic should be treated as **high-risk** and reviewed carefully.

---

# Supabase Rules

Be careful with database-related changes.

When modifying Supabase usage:

- avoid destructive schema changes
- clearly explain SQL migrations
- identify required environment variables
- ensure authentication flows remain intact

If a schema change is required, clearly describe the migration steps.

---

# Mobile UX Requirements

The app is **mobile-first**.

Changes must:

- work well on small screens
- maintain responsive layout
- preserve touch-friendly controls

Avoid desktop-only assumptions.

---

# Versioning Rules

This project uses versioning to ensure **service worker updates propagate correctly**.

When updating version numbers:

- keep version references consistent
- ensure cache invalidation still works
- verify that service worker updates will trigger correctly

Do not modify versioning logic without understanding the update mechanism.

---

# Git Workflow

Agents should work in **small, reviewable changes**.

Typical workflow:

1. create or use the current working branch
2. make minimal edits
3. verify behavior locally
4. commit clearly
5. push for review

Avoid large commits or touching unrelated files.

Do not rewrite history or force-push unless explicitly instructed.

---

# Pre-Push Checklist

Before pushing changes:

1. confirm functionality works
2. verify mobile layout
3. confirm service worker behavior
4. ensure no unrelated files were modified
5. confirm Supabase changes are safe
6. update documentation if workflows, architecture, or commands changed

---

# Documentation Maintenance

If a change affects:

- setup
- commands
- architecture
- deployment
- environment variables
- known gotchas

then update documentation accordingly.

Documentation should stay:

- concise
- accurate
- consistent with the codebase

Avoid unnecessary documentation churn for trivial UI or copy changes.

---

# Agent Behavior Summary

Agents working in this repository should:

- read project documentation first
- prefer **small safe edits**
- respect existing conventions
- clearly explain changes
- provide verification steps
- avoid unnecessary complexity
- preserve the simplicity of the project