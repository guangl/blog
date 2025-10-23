# guangluo's blog

这是个人使用 Hugo 构建的静态博客站点仓库，主题为 `yinyang`，托管在 GitHub Pages（https://guangluo.github.io/blog/）。

## 仓库结构（部分）

- `archetypes/` - Hugo 新建文章模板
- `content/posts/` - 博客文章的 Markdown 源文件
- `public/` - Hugo 构建输出（可直接部署）
- `static/` - 静态资源（图片、数据库备份等）
- `themes/yinyang/` - 站点主题
- `hugo.toml` - 站点配置

## 本地预览

1. 安装 Hugo（参考 https://gohugo.io/）
2. 在仓库根目录运行：

```powershell
hugo server -D
```

3. 浏览器打开 http://localhost:1313/ 查看预览

## 构建与部署

构建静态站点：

```powershell
hugo
```

构建产物在 `public/` 目录，可将其内容推到 GitHub Pages 或其他静态托管服务。

## 常见命令

- 新建文章：

```powershell
hugo new posts/my-new-post.md
```

- 本地预览：

```powershell
hugo server -D
```

## 许可证

仓库中内容（文章与配置）版权归作者所有。若需转载请联系作者。