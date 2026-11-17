---
title: 达梦查活动会话
date: 2026-11-17
tags:
  - 达梦/会话与锁
---

排查慢 SQL 时，先确认哪几个会话处于 `ACTIVE`，再用会话 ID 和事务 ID 查完整 SQL 或等待关系。

## 查当前实例

单机直接执行。主备环境中，连到需要排查的实例执行。

```sql
SELECT s.sess_id,
       s.trx_id,
       s.user_name,
       s.state,
       s.appname,
       s.clnt_ip,
       s.last_recv_time,
       s.sql_text,
       t.ins_cnt,
       t.del_cnt,
       t.upd_cnt
FROM v$sessions s
LEFT JOIN v$trx t ON t.id = s.trx_id
WHERE s.state = 'ACTIVE'
  AND s.sess_id <> SESSID()
ORDER BY s.last_recv_time;
```

`LEFT JOIN` 保留暂时匹配不到事务信息的活动会话。`INS_CNT`、`DEL_CNT`、`UPD_CNT` 是事务的回滚记录计数。最近接收请求的时间适合用来排序，单条 SQL 的执行耗时需要另查。如果要查看完整 SQL，把示例 ID 换成上面查到的本实例会话 ID。

```sql
SELECT SF_GET_SESSION_SQL(123456) AS full_sql;
```

这个函数返回会话最近处理的完整语句。排查时可以重新查一次会话状态，确认两次采样之间有没有变化。

## 查 DSC 各节点

```sql
SELECT s.instance_name,
       s.sess_id,
       s.trx_id,
       s.state,
       s.last_recv_time,
       s.sql_text
FROM gv$sessions s
WHERE s.state = 'ACTIVE'
ORDER BY s.last_recv_time;
```

找到目标实例后，可以连到该节点用本地查询补看事务计数和完整 SQL。也可以查到会话所在的节点号后，用 `SF_GET_SESSION_SQL(节点号, 会话 ID)` 读取。怀疑存在事务阻塞时，[按 DSC 的活动节点数选择等待视图](../dm-blocking-sessions/)。

[达梦文档 · 动态视图](https://eco.dameng.com/document/dm/zh-cn/pm/dm8-admin-manual-appendix2.html) · [达梦文档 · SF_GET_SESSION_SQL](https://eco.dameng.com/document/dm/zh-cn/pm/sql-appendix.html)
