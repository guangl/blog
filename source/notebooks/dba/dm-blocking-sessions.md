---
title: 达梦查阻塞：从等待事务找到阻塞会话
date: 2026-11-17
tags:
  - 达梦/会话与锁
---

SQL 长时间等不到结果时，可以先查事务等待关系。下面前两条查询适用于单机和只有一个活动节点的 DSC。此时 `V$TRXWAIT.ID` 是等待方事务 ID，`WAIT_FOR_ID` 是它正在等的事务 ID。

## 先看谁在等谁

```sql
SELECT w.id AS waiting_trx_id,
       waiting.sess_id AS waiting_sess_id,
       w.wait_for_id AS blocking_trx_id,
       blocking.sess_id AS blocking_sess_id,
       w.wait_time AS wait_ms
FROM v$trxwait w
LEFT JOIN v$sessions waiting ON waiting.trx_id = w.id
LEFT JOIN v$sessions blocking ON blocking.trx_id = w.wait_for_id
ORDER BY w.wait_time DESC;
```

`WAIT_MS` 的单位是毫秒。事务等待和会话状态会变化，即使这一刻没有查到对应会话，查询也会保留等待关系。

## 再找等待链的源头

如果会话 C 等 B、B 等 A，上一条查询会列出两段关系。下面从会话中挑出被其他事务等待、自己没有出现在等待方列表里的事务。在这个例子里会找到 A。

```sql
SELECT s.sess_id, s.trx_id, s.user_name, s.state, s.sql_text
FROM v$sessions s
WHERE EXISTS (
  SELECT 1 FROM v$trxwait w WHERE w.wait_for_id = s.trx_id
)
AND NOT EXISTS (
  SELECT 1 FROM v$trxwait w WHERE w.id = s.trx_id
);
```

这里保留 `IDLE` 会话，因为连接空闲时仍可能有未提交事务。如果等待关系形成环，查询可能找不到源头，可以回到第一条查询查看各段关系。

## DSC 有多个活动节点时

从任意节点查 `V$DSC_TRXWAIT`。在这个视图里，等待方的事务号是 `TRX_ID`。

```sql
SELECT w.ep_seqno AS waiting_node,
       w.trx_id AS waiting_trx_id,
       w.wait_for_id AS blocking_trx_id,
       w.wait_time AS wait_ms
FROM v$dsc_trxwait w
ORDER BY w.wait_time DESC;
```

拿到事务 ID 后，可以在 `V$DSC_TRX` 按 `ID` 查事务所在节点 `EP_SEQNO` 和会话号 `SESS_ID`。结合两边的事务号就能追踪跨节点的等待关系。

[达梦文档 · SQL 长时间等待问题](https://eco.dameng.com/document/dm/zh-cn/ops/troubleshooting-sql.html) · [达梦文档 · 监控 DMDSC](https://eco.dameng.com/document/dm/zh-cn/pm/dsc-monitor.html)
