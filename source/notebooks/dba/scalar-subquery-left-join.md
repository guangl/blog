---
title: 标量子查询改写为 LEFT JOIN
date: 2026-11-17
tags:
  - SQL 优化
---

查明细时，如果每行都要去另一张表取一个值，可以先看被查一侧的关联键是否唯一。下面这个例子从 `test_lg2` 取明细，按 `b2` 去 `test_lg1` 找对应的 `a1`。

```sql
SELECT b.a2,
       (SELECT a.a1 FROM test_lg1 a WHERE a.b1 = b.b2) AS matched_id
FROM test_lg2 b;

SELECT b.a2, a.a1 AS matched_id
FROM test_lg2 b
LEFT JOIN test_lg1 a ON a.b1 = b.b2;
```

先确认 `test_lg1.b1` 对每个输入值至多命中一行。没有匹配时，两个写法都保留明细行并返回 `NULL`。如果命中多行，`LEFT JOIN` 会让一条明细变成多行。原写法在达梦和 PostgreSQL 会报错，SQLite 则会取子查询的首行。关联键有唯一约束时，可以直接验证这个改写的前提。

原达梦案例中，改写前的执行计划有 `SPL2` 和带外层变量的索引查找，改写后出现 `HASH LEFT JOIN2`。在目标数据库中用同一批数据比较结果行、执行计划和实际耗时。优化器选的连接方式会随数据和索引变化。

[达梦文档 · 标量子查询](https://eco.dameng.com/document/dm/zh-cn/pm/check-phrases.html) · [PostgreSQL · 标量子查询](https://www.postgresql.org/docs/current/sql-expressions.html#SQL-SYNTAX-SCALAR-SUBQUERIES) · [SQLite · 子查询表达式](https://www.sqlite.org/lang_expr.html#subquery_expressions)
