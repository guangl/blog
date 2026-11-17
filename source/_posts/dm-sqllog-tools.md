---
title: 排查达梦 SQL 日志：从解析到导出
date: 2026-11-17 22:24:30
updated: 2026-11-17 22:40:50
categories:
  - 数据库
tags:
  - 达梦
  - SQL 日志
  - Rust
description: 达梦 SQL 日志怎么查？用 sqllog2db 查看慢 SQL、导出 Parquet 或 CSV，用 Rust 解析库逐条读取日志，并说明两者的依赖关系和适用范围。
article:
  ai_label: generated
---

拿到一批达梦 SQL 日志，通常先要回答两个问题：哪些语句单次执行最慢，哪些语句虽然不慢却反复出现。手里的日志包含 `[ORA]` 记录时，可以先用 `sqllog2db stats` 找线索；要查其他标签，或反复按时间、用户和会话筛选，就先导成 Parquet。如果手头已有 Rust 程序，需要自己决定怎么处理每条记录，可以直接用解析库。

<!-- more -->

## 两个项目是什么关系

| 项目 | 适合什么时候用 | 得到什么 |
| --- | --- | --- |
| [dm-database-sqllog2db](https://github.com/guangl/dm-database-sqllog2db) | DBA 临时排查、批量导出或归档 | 终端里的慢 SQL / 高频 SQL（只统计 `[ORA]`），或一个 Parquet、CSV 文件 |
| [dm-database-parser-sqllog](https://github.com/guangl/dm-database-parser-sqllog) | 给已有的 Rust 程序接入达梦传统 SQL 日志 | 逐条返回的 `Sqllog` 记录和解析错误，由调用方处理 |

默认构建的 `sqllog2db` 支持达梦传统 SQL 日志和 JDBC 驱动日志。传统日志由 `dm-database-parser-sqllog` 解析，再由 CLI 内部的[适配器](https://github.com/guangl/dm-database-sqllog2db/blob/324c945f8502c8e7d11a749da3bebf017d5cf7e9/src/infrastructure/input/adapters/sql_log.rs#L8-L35)把 `Sqllog` 转为统一的 `LogRecord`；JDBC 日志走另一套解析器。直接用 CLI 时，只需准备日志文件，不需要单独安装解析库，也不需要连接原数据库。

![sqllog2db 先识别日志格式，传统日志经 Rust 解析库、JDBC 日志经驱动日志解析器，统一成 LogRecord 后由 run 导出文件或由 stats 汇总 ORA 标签记录。](sqllog-pipeline.svg)

## 两个仓库的架构

两张图都可以打开交互版。点选节点可查看对应提交的源码位置。

### sqllog2db：从输入适配到输出

传统 SQL 日志和驱动日志各自解析，统一成 `LogRecord`。`run` 用这些记录做过滤和导出，`stats` 单独扫描并汇总。

![sqllog2db 架构图。输入适配层向 run 处理管道和 stats 统计提供 LogRecord，分别输出本地文件和终端表格。](archify-sqllog2db.svg)

{% asset_link archify-sqllog2db/index.html 打开 sqllog2db 交互架构图 %}

### parser-sqllog：从日志字节到 Rust 记录

同步迭代器逐行读取，按时间戳识别记录边界，再逐条返回 `Sqllog` 或解析错误。异步接口复用同一迭代器，并收集为一批记录。

![parser-sqllog 架构图。文件迭代器合并多行日志，解码后逐条返回结果，也可以选择组合过滤或异步批量收集。](archify-parser-sqllog.svg)

{% asset_link archify-parser-sqllog/index.html 打开 parser-sqllog 交互架构图 %}

## 先用 stats 缩小范围

可以从 [GitHub Releases](https://github.com/guangl/dm-database-sqllog2db/releases) 下载二进制文件。用 Cargo 安装本文对应的版本需要 Rust 1.95 或更新版本：

```bash
cargo install dm-database-sqllog2db --version 3.0.2 --locked
```

安装后生成配置：

```bash
sqllog2db init -o config.toml
```

在生成的 `config.toml` 中，把 `[sqllog]` 的 `inputs` 改为自己的日志文件、目录或 glob。第一次排查时，可以先放一小段与问题时段对应的日志，确认解析出来的用户名、语句和耗时与原文一致。

```bash
sqllog2db stats -c config.toml --top 10
```

**`stats` [只统计 `[ORA]` 标签的记录](https://github.com/guangl/dm-database-sqllog2db/blob/324c945f8502c8e7d11a749da3bebf017d5cf7e9/src/stats/aggregate.rs#L89-L98)。** 如果日志只有 `[SEL]` 等其他标签，表格可能为空；这时可以导出文件再查。

`Slow SQL` 按单次耗时找值得先看的语句。`Frequent SQL` 把相近的 SQL 按归一化后的文本汇总，同时给出调用次数、平均耗时和最大耗时。前者适合找一次特别慢的执行，后者适合看哪些语句在不断消耗资源。需要限定时间，可加 `--from` 和 `--to`。这个命令直接扫描原始日志，不用先导出；它使用 `[stats]` 的时间范围，导出用的 `[filter]` 不会应用到这里。

## 导出 Parquet，用 DuckDB 继续查

如果要把会话、用户和事务放到一起查，可以把 `config.toml` 写成下面这样。示例从 `./sqllogs` 读取日志，写到 `outputs/sqllog.parquet`。`overwrite = true` 会替换同名文件，试跑时请用单独的输出路径。

```toml
[sqllog]
inputs = ["./sqllogs"]

[exporter.parquet]
file = "outputs/sqllog.parquet"
compression = "zstd"
overwrite = true
```

```bash
sqllog2db validate -c config.toml
sqllog2db run -c config.toml
```

打开 DuckDB，按记录中的执行时间查看最慢的 10 条：

```sql
SELECT ts, username, sess_id, trx_id, exec_time_ms, sql
FROM read_parquet('outputs/sqllog.parquet')
ORDER BY exec_time_ms DESC
LIMIT 10;
```

如果只需把结果交给同事用表格工具打开，就改配 `[exporter.csv]`。一次运行只选一种格式；两个导出器同时配置时优先选 Parquet。

导出前还可以在 `[filter.include]` 和 `[filter.exclude]` 缩小范围。这里有一个容易忽略的差别：用户名、标签等条件逐条匹配；`min_runtime_ms` 等指标和 SQL 内容条件则会先扫描日志收集命中的事务 ID。例如设置包含条件 `min_runtime_ms = 100`，同一事务里耗时不到 100 毫秒的记录也可能被导出，便于回看慢语句前后发生了什么。要看事务上下文，就尽量把覆盖前后时段的文件一起输入；工具只能保留日志里已有的记录。

## 在 Rust 程序里逐条读

如果业务逻辑已经在 Rust 里，可以只用 [dm-database-parser-sqllog](https://docs.rs/dm-database-parser-sqllog/2.0.4/) 读取传统 SQL 日志。下面的例子逐条打印不低于 100 毫秒的记录，遇到解析错误时把错误留在标准错误流里：

```toml
[dependencies]
dm-database-parser-sqllog = "2.0.4"
```

```rust
use dm_database_parser_sqllog::LogParserBuilder;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let parser = LogParserBuilder::new("sqllogs/sample.log").build()?;
    for record in parser.iter()? {
        match record {
            Ok(row) if row.exectime >= 100.0 => {
                println!("{} | {} | {} ms | {}", row.ts, row.username, row.exectime, row.sql);
            }
            Ok(_) => {}
            Err(err) => eprintln!("解析失败：{err}"),
        }
    }
    Ok(())
}
```

这里的 100 毫秒条件是逐条判断，不会保留同一事务里的其他记录。需要多条件组合时可用 `FilterBuilder`；使用 Tokio 时也可以打开 `async` feature。异步接口的 `parse().await` 会把结果收集到 `Vec<Sqllog>`，大文件逐条消费时更适合同步迭代接口。

## 使用前先对一份样本

两个仓库的 README 都标明已停止维护。本文按 `sqllog2db` 的 [`324c945`](https://github.com/guangl/dm-database-sqllog2db/tree/324c945f8502c8e7d11a749da3bebf017d5cf7e9) 和解析库的 [`c38ec75`](https://github.com/guangl/dm-database-parser-sqllog/tree/c38ec755013309097115adae065372543a316479) 整理。不同达梦版本的日志字段和分隔符可能变化，第一次在新环境使用，先拿少量样本对照原文再跑整个目录。导出的 SQL 文本和参数可能包含业务数据，对外分享前也要检查。
