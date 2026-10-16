---
title: 连接数打满时先看这三件事
layout: post
date: 2026-10-05 09:30:00
updated: 2026-10-05 09:30:00
categories:
  - 数据库运维
tags:
  - PostgreSQL
  - 连接池
  - 故障排查
collection:
  profile: topic
  id: dba-troubleshooting
description: 应用报「too many clients」时不一定要立刻扩容，先分清是连接泄漏、空闲事务还是真实并发。
---

## 结论先行

应用报 `FATAL: sorry, too many clients already` 时，第一反应常常是把 `max_connections` 调大。但在多数案例里，真正的原因只有三类：**连接泄漏**、**空闲事务占坑**、**真实并发超过池容量**。先把这三件事分清，再决定要不要改参数。

## 环境与版本

| 项目 | 实际环境 |
| --- | --- |
| 数据库产品与完整版本 | PostgreSQL 14 及以上 |
| 部署架构与实例角色 | 单主库 + 只读从库 |
| 数据规模与负载特点 | 应用层使用连接池，高峰期并发明显上升 |
| 相关参数或近期变更 | 关注 `max_connections`、`idle_in_transaction_session_timeout` |

以下查询都是只读的，可在主库直接执行。

## 问题现象

- 应用侧出现连接获取超时或 `too many clients` 报错。
- 重启应用后短时间恢复，过一段时间再次出现。
- 数据库自身负载不高，但连接槽位已经占满。

## 排查过程

### 第一步：按状态给连接分组

先看清当前连接都停在什么状态，而不是只看总数。

```sql
SELECT state, count(*)
FROM pg_stat_activity
WHERE backend_type = 'client backend'
GROUP BY state
ORDER BY count(*) DESC;
```

如果 `idle` 占绝大多数，方向是**连接泄漏**；如果 `idle in transaction` 明显，方向是**事务没提交**；如果 `active` 居多，才是真实的并发压力。

### 第二步：定位泄漏来源

按应用账号和来源地址聚合，找出是谁占着不放。

```sql
SELECT usename, client_addr, state, count(*),
       min(backend_start) AS oldest
FROM pg_stat_activity
WHERE backend_type = 'client backend'
GROUP BY usename, client_addr, state
ORDER BY count(*) DESC;
```

`oldest` 如果远早于其它连接，说明存在长期不释放的连接，通常对应池配置不当或应用未正确归还。

### 第三步：确认有没有空闲事务

空闲事务会一直持有快照，阻塞清理并占住槽位。

```sql
SELECT pid, usename, state, now() - state_change AS idle_for, left(query, 80) AS last_query
FROM pg_stat_activity
WHERE state = 'idle in transaction'
ORDER BY idle_for DESC;
```

## 处理步骤

按确认到的原因分别处理，不要一次改多项：

1. **连接泄漏**：先修应用侧归还逻辑与池上限，再观察连接数曲线。
2. **空闲事务**：为长事务设置 `idle_in_transaction_session_timeout`，让占坑连接自动断开。
3. **真实并发**：评估内存与 CPU 后，通过连接池收敛并发，而不是无限放大 `max_connections`。

`max_connections` 调大是有代价的：每个连接都有独立内存开销，盲目调高可能把内存吃满。

## 验证结果

| 验证项或指标 | 处理前 | 处理后 | 是否符合预期 |
| --- | --- | --- | --- |
| 连接总数峰值 | 接近上限 | 明显回落 | 是 |
| `idle in transaction` 数量 | 持续存在 | 基本归零 | 是 |
| 应用报错频率 | 高峰期复现 | 未再复现 | 是 |

## 回退方案

改参数前记录原值，回退时逐项恢复。`idle_in_transaction_session_timeout` 若设置过短，可能误杀正常的长事务，建议先设一个较宽松的值并观察，再逐步收紧。

## 总结与参考

把连接数监控按 `state` 维度拆分，比只看总量更容易提前发现问题。建议对连接数峰值和 `idle in transaction` 都设置告警。

参考：[PostgreSQL 官方文档 · Monitoring Database Activity](https://www.postgresql.org/docs/current/monitoring-stats.html)。
