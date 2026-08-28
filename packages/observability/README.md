# Operational observability

This package emits newline-delimited, versioned operational events and keeps a bounded in-process metrics snapshot. Its public event contract intentionally accepts only route templates, status/outcome values, durations, and aggregate counts.

It cannot accept source text, questions, repository URLs, identifiers, arbitrary metadata, access codes, or provider credentials. Writer failures are isolated from application behavior. The hosted entrypoints write these events to standard output for capture by the deployment platform.
