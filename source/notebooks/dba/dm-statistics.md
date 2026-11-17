---
title: 达梦查看表、列和索引的统计信息
date: 2026-11-17
description: 用 DBMS_STATS 查看表行数、列值分布和索引统计，辅助判断执行计划里的行数估算。
tags:
  - 达梦/统计信息
---

看执行计划时，如果估算行数和实际行数差得多，可以先看看优化器手里的统计信息。下面三个过程只展示已经收集的数据，参数传入实际的模式名、表名、列名或索引名，并保留对象名的大小写。

```sql
-- 表统计：模式名、表名
CALL DBMS_STATS.TABLE_STATS_SHOW('APP', 'ORDERS');

-- 列统计：模式名、表名、列名
CALL DBMS_STATS.COLUMN_STATS_SHOW('APP', 'ORDERS', 'STATUS');

-- 索引统计：模式名、索引名
CALL DBMS_STATS.INDEX_STATS_SHOW('APP', 'IDX_ORDERS_STATUS');
```

- **表**看 `NUM_ROWS`，这是统计信息记录的总行数。和当前行数差得多时，可以再核对统计信息的收集情况。
- **列**看 `NUM_DISTINCT`、`NUM_NULLS` 和直方图。比如排查 `STATUS` 过滤条件时，可以看看该列的不同值个数以及分布是否偏斜。
- **索引**可以看 `BLEVEL`、`LEAF_BLOCKS` 和 `DISTINCT_KEYS`，分别了解树的层次、页数和不同键的数量。

如果查不到结果，先核对名称、对象查询权限和是否收集过统计信息。表与索引统计需要表查询权限，列统计需要相应的列查询权限。

[达梦文档 · DBMS_STATS 包](https://eco.dameng.com/document/dm/zh-cn/pm/dbms_stats-package)
