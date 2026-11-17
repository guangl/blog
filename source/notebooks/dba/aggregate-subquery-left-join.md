---
title: 带 MAX 的标量子查询改写为 LEFT JOIN
date: 2026-11-17
tags:
  - 达梦/SQL 优化
---

按外层行重复查询最大值时，可以先按关联键算出每组的 `MAX`，再把结果连回外层表。

```sql
SELECT a.a1,
       (SELECT MAX(b.b2) FROM test_lg2 b WHERE b.a2 = a.a1) AS max_b2
FROM test_lg1 a;

SELECT a.a1, g.max_b2
FROM test_lg1 a
LEFT JOIN (
  SELECT b.a2, MAX(b.b2) AS max_b2
  FROM test_lg2 b
  GROUP BY b.a2
) g ON g.a2 = a.a1;
```

分组后，每个关联键最多有一行。外层关联键没有匹配时，`LEFT JOIN` 保留这一行，`max_b2` 仍为 `NULL`。如果改写的是 `COUNT(*)`，则要用 `COALESCE` 把未匹配时的 `NULL` 转回原查询返回的 `0`。

原笔记里，改写前的计划在带外层变量的分支中执行聚合。改写后，重点比较预聚合的代价和原先逐行查找的代价。外层只取少量行时，先把内表全部分组未必划算。
