---
title: OR 改写为 UNION 时如何保留重复值
date: 2026-11-17
tags:
  - SQL 优化
---

一行同时满足两个 `OR` 条件时，原查询只返回这一行。改成 `UNION ALL`，它会返回两次。直接用 `UNION` 合并输出列，又可能把两条输出值相同的源记录合成一条。

例如，测试表 `test_lg1(a1, b1, c1)` 以 `a1` 为主键，放入 `(0, 2, 3)`、`(1, 2, 3)`、`(2, 3, 4)`、`(3, 4, 5)` 四行。下面的原查询返回三个值 `2、2、4`。用 `UNION` 合并时，先带上主键做去重，再在外层只取 `b1`，就能保留两个 `2`。

```sql
SELECT b1
FROM test_lg1
WHERE b1 = 2 OR c1 = 5;

SELECT u.b1
FROM (
  SELECT a1, b1 FROM test_lg1 WHERE b1 = 2
  UNION
  SELECT a1, b1 FROM test_lg1 WHERE c1 = 5
) u;
```

再加一行 `(4, 2, 5)`，它会同时命中两个分支。两种写法都应返回四行，其中 `2` 出现三次。核对结果时要比较每个值出现的次数。有顺序要求时，把 `ORDER BY` 写在最外层。

如果是为了让两个分支分别利用索引，先看原查询在目标数据库里的执行计划。有些优化器已能对 `OR` 的各分支利用不同索引。改写后也要把合并时去重的代价算进去。

[PostgreSQL · UNION](https://www.postgresql.org/docs/current/sql-select.html#SQL-UNION) · [达梦文档 · 多表联合检索](https://eco.dameng.com/document/dm/zh-cn/sql-dev/practice-multi-table.html)
