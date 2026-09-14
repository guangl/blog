# guangluo's blog

基于 [Hexo](https://hexo.io/) 和 [Stellar](https://github.com/xaoxuu/hexo-theme-stellar) 的个人技术博客，使用中文记录技术成长、工程实践与生活思考。

## 本地运行

### 环境要求

- [Bun](https://bun.sh/) 1.0 或更高版本

### 安装依赖

```bash
bun install
```

### 启动开发服务器

```bash
bun run server
```

启动后访问 <http://localhost:4000/blog/>。

### 生成静态文件

```bash
bun run build
```

生成的文件位于 `public/` 目录。清理缓存和生成文件：

```bash
bun run clean
```

## 技术栈

- [Hexo](https://hexo.io/)：静态博客生成器
- [Stellar](https://github.com/xaoxuu/hexo-theme-stellar)：博客主题
- [Bun](https://bun.sh/)：JavaScript 运行时和包管理器
- GitHub Pages：静态网站托管

## 许可证

文章、图片和配置文件均以 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可发布，详情见 [LICENSE](LICENSE)。转载或改编时请注明作者 Guang Luo，并附上许可证链接。
