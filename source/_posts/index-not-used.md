---
title: 索引没生效的几种常见原因
layout: post
date: 2026-10-12 14:20:00
updated: 2026-10-12 14:20:00
categories:
  - 数据库运维
tags:
  - PostgreSQL
  - 索引
  - 执行计划
collection:
  profile: topic
  id: dba-troubleshooting
description: 索引建了却没被用上，多半是列顺序、类型转换或选择性问题，逐条排查即可。
---

## 结论先行

「索引建了却走顺序扫描」是排查中最常见的一类困惑。原因通常不出这五种：**复合索引列顺序不对**、**条件里有隐式类型转换**、**对列做了函数运算**、**选择性问题（返回比例过高）**、**统计信息过期**。按顺序排除即可，不必反复重建索引。

## 环境与版本

| 项目 | 实际环境 |
| --- | --- |
| 数据库产品与完整版本 | PostgreSQL 14 及以上 |
| 部署架构与实例角色 | 单主库 |
| 数据规模与负载特点 | 索引列基数差异较大 |
| 相关参数或近期变更 | 关注 `random_page_cost` 等代价参数 |

## 问题现象

- 已经为目标列建立了索引，执行计划仍然显示 `Seq Scan`。
- 手动 `EXPLAIN` 时能用上索引，线上却用不上（或相反）。
- 同一条语句在不同环境下表现不同。

## 排查过程

### 逐个排除原因

**1. 复合索引列顺序**

复合索引遵循最左前缀原则。`(a, b)` 能服务 `WHERE a = ?` 和 `WHERE a = ? AND b = ?`，但服务不了单独的 `WHERE b = ?`。

**2. 隐式类型转换**

列是 `varchar` 而条件传了数字，比较时会对列做转换，索引失效。

```sql
-- 假设 code 是 varchar 类型
SELECT * FROM t WHERE code = 123;      -- 可能失效
SELECT * FROM t WHERE code = '123';    -- 正常走索引
```

**3. 条件里对列做运算**

```sql
SELECT * FROM t WHERE created_at::date = '2026-10-01';  -- 失效
SELECT * FROM t
WHERE created_at >= '2026-10-01' AND created_at < '2026-10-02';  -- 可用
```

**4. 选择性问题**

如果一个条件会命中表里大部分行，优化器认为顺序扫描更划算。这时建索引收益有限。

**5. 统计信息过期**

预估行数严重偏离实际时，优化器会选错计划。

```sql
SELECT relname, last_analyze, last_autoanalyze, n_live_tup
FROM pg_stat_user_tables
WHERE relname = 'your_table';
```

### 用实际计划确认

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT ... ;
```

对比预估 `rows` 与实际 `rows`，看 `Filter` 上被丢掉的行数。如果 `Filter` 丢弃比例很高，说明该列适合进索引。

## 处理步骤

1. 先用 `EXPLAIN` 确认当前计划，别凭猜。
2. 按上面五条逐一核对，定位到具体原因后再动手。
3. 需要调整索引时优先用 `CREATE INDEX CONCURRENTLY`，避免阻塞写入。
4. 改了统计信息后用同一条 `EXPLAIN` 复测，对比前后计划。

## 验证结果

| 验证项或指标 | 处理前 | 处理后 | 是否符合预期 |
| --- | --- | --- | --- |
| 扫描方式 | Seq Scan | Index Scan | 是 |
| `Filter` 丢弃行数 | 大量 | 明显减少 | 是 |
| 语句平均耗时 | 偏高 | 下降 | 是 |

## 回退方案

新增的索引若确认无用，用 `DROP INDEX CONCURRENTLY` 删除。类型转换类的改动涉及应用侧传参，回退时要同步回退代码，避免只改一端。

## 总结与参考

索引是否生效，最终以 `EXPLAIN` 的实际计划为准。把这五条原因做成排查清单，能省下大量反复建索引的时间。

参考：[PostgreSQL 官方文档 · Indexes](https://www.postgresql.org/docs/current/indexes.html)。
