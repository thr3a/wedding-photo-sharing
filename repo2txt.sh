docker run --rm -v ./:/app thr3a/repo2text \
-d dummy \
-f repoinfo.md package.json next.config.js src/app/layout.tsx src/app/page.tsx \
 > repo.md
