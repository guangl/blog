---
title: 一条慢查询的定位过程
layout: post
date: 2026-10-08 10:15:00
updated: 2026-10-08 10:15:00
categories:
  - 数据库运维
tags:
  - PostgreSQL
  - 慢查询
  - 执行计划
collection:
  profile: topic
  id: dba-troubleshooting
description: 从 pg_stat_statements 找到最耗时的语句，再用 EXPLAIN 看清它到底慢在哪一步。
---

## 结论先行

「数据库变慢了」不能直接变成「加索引」。正确的顺序是：**先用统计视图确定是哪条语句在消耗资源，再用执行计划确认慢在哪一步**，最后才谈优化。跳过前两步，很容易优化了一条本来就不慢的语句。

## 环境与版本

| 项目 | 实际环境 |
| --- | --- |
| 数据库产品与完整版本 | PostgreSQL 14 及以上 |
| 部署架构与实例角色 | 单主库 |
| 数据规模与负载特点 | 业务表达到千万行级别 |
| 相关参数或近期变更 | 需要启用 `pg_stat_statements` |

## 问题现象

- 接口响应时间在业务高峰期明显上升。
- 数据库 CPU 使用率升高，但整体 QPS 变化不大。
- 无法从应用日志直接看出是哪条 SQL 导致的。

## 排查过程

### 第一步：按累计耗时排序

不要只看单次耗时，累计耗时才能反映真实的资源消耗占比。

```sql
SELECT calls,
       round(total_exec_time::numeric, 2) AS total_ms,
       round(mean_exec_time::numeric, 2)  AS mean_ms,
       rows,
       left(query, 100) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
```

注意区分两种情况：**单次很慢**（`mean_exec_time` 高）和**单次不慢但调用极多**（`calls` 高）。两者的优化方向完全不同。

### 第二步：看清执行计划

拿到语句后用 `EXPLAIN` 判断瓶颈位置。生产环境建议先加 `(ANALYZE, BUFFERS)` 但不实际执行写操作。

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT ... ;
```

重点看三处：

- 是否存在大表上的 **Seq Scan**。
- 预估行数（`rows`）与实际行数是否差一个数量级。
- `Buffers` 里的 `read` 是否远高于 `hit`，说明缓存命中率低。

预估与实际严重偏离，通常意味着统计信息过期，先 `ANALYZE` 再判断。

### 第三步：确认统计信息是否新鲜

```sql
SELECT relname, last_analyze, last_autoanalyze, n_live_tup
FROM pg_stat_user_tables
ORDER BY last_autoanalyze NULLS FIRST
LIMIT 20;
```

## 处理步骤

按执行计划给出的证据处理，一次只改一处：

1. **统计信息过期**：手动 `ANALYZE` 后重新看计划。
2. **缺少合适索引**：按实际过滤条件建立索引，注意复合索引的列顺序。
3. **索引存在但没用上**：检查条件是否对列做了函数运算或隐式类型转换。
4. **返回行数本身就大**：考虑分页或改写查询，而不是加索引。

## 验证结果

| 验证项或指标 | 处理前 | 处理后 | 是否符合预期 |
| --- | --- | --- | --- |
| 该语句 `mean_exec_time` | 数百毫秒 | 降至毫秒级 | 是 |
| 执行计划扫描方式 | Seq Scan | Index Scan | 是 |
| 高峰期 CPU 使用率 | 明显偏高 | 回落 | 是 |

## 回退方案

新建索引可以先 `CREATE INDEX CONCURRENTLY`，避免长时间持锁；确认无用后用 `DROP INDEX CONCURRENTLY` 移除。如果改写查询导致结果集变化，回退到原语句并复核对账逻辑。

## 总结与参考

`pg_stat_statements` 适合发现「谁在消耗资源」，`EXPLAIN` 负责回答「为什么慢」，两者要配合使用。建议把该视图纳入日常巡检。

参考：[PostgreSQL 官方文档 · Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)。
