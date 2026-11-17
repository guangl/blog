---
title: 标量子查询改写为 LEFT JOIN
date: 2026-11-17
tags:
  - 达梦/SQL 优化
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

先确认 `test_lg1.b1` 对每个输入值至多命中一行。没有匹配时，两个写法都保留明细行并返回 `NULL`。命中多行时，达梦的标量子查询会报错，直接改成 `LEFT JOIN` 则会增加结果行。

原笔记里，改写前的执行计划有 `SPL2` 和带外层变量的索引查找，改写后出现 `HASH LEFT JOIN2`。关联键唯一只是结果等价的条件。是否值得改，要用同一批数据核对结果行和实际耗时。

[达梦文档 · 标量子查询](https://eco.dameng.com/document/dm/zh-cn/pm/check-phrases.html)
