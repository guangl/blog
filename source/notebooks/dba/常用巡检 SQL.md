---
date: 2026-10-17 01:01
updated: 2026-10-17 01:08
title: "常用巡检 SQL"
tags:
  - "postgresql/巡检"
  - "postgresql/运维"
---

日常巡检用得到的几条查询，都在只读范围内，可以直接在主库执行。

## 数据库与连接概况

```sql
SELECT datname, numbackends, xact_commit, xact_rollback,
       blks_read, blks_hit, deadlocks
FROM pg_stat_database
WHERE datname IS NOT NULL;
```

`blks_hit` 相对 `blks_read` 明显偏低时，值得进一步看缓存命中。

## 表膨胀与清理情况

```sql
SELECT relname, n_live_tup, n_dead_tup,
       last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 20;
```

`n_dead_tup` 持续偏高且自动清理长期未运行，需要考虑清理策略。

## 长事务与锁等待

```sql
SELECT pid, now() - xact_start AS xact_age, state, left(query, 70)
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start
LIMIT 10;
```

```sql
SELECT blocked.pid AS blocked_pid,
       blocking.pid AS blocking_pid,
       left(blocked.query, 60) AS blocked_query
FROM pg_stat_activity AS blocked
JOIN pg_stat_activity AS blocking
  ON blocking.pid = ANY(pg_blocking_pids(blocked.pid));
```

## 复制延迟

```sql
SELECT client_addr, state, sent_lsn, replay_lsn,
       pg_wal_lsn_diff(sent_lsn, replay_lsn) AS replay_lag_bytes
FROM pg_stat_replication;
```

