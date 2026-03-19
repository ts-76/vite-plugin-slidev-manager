# vite-plugin-slidev-manager

[English README](../../README.md)

モノレポ内の複数の Slidev プレゼンテーションを管理するための Vite プラグインです。

## 特徴

- `dev`、`build`、`export:browser` でプレゼンテーションセレクターを提供
- workspaceと非workspace両方のプレゼンテーションをサポート
- Slidev deck 用の、ページ内 deck 切り替え UI を搭載
- Slidev CLI 引数の透過的な受け渡し

## 要件

- 利用中の Vite / Slidev バージョンがサポートする Node.js バージョン
- `vite` `^5 || ^6 || ^7 || ^8`
- `@slidev/cli` `>=52.14.1`

## インストール

```bash
npm install -D vite-plugin-slidev-manager vite @slidev/cli
```

## 使い方

### 1. Vite を設定する

```ts
import { defineConfig } from 'vite';
import presentationManager from 'vite-plugin-slidev-manager';

export default defineConfig({
    plugins: [
        presentationManager({
            presentationsDir: 'presentations',
        }),
    ],
});
```

### 2. script を追加する

```json
{
    "scripts": {
        "dev": "vite",
        "build": "vite build",
        "export:browser": "vite -- --export"
    }
}
```

`vite export` ではなく `vite -- --export` を使ってください。  
`vite export` は標準の Vite コマンドではなく、このプラグインは転送された `--export` フラグを使って browser export モードへ切り替えます。

### 3. コマンドを実行する

```bash
npm run dev
npm run build
npm run export:browser
```

- `npm run dev`
    - セレクターを表示します
    - 選択した deck を安定した bridge URL の背後で起動します
    - `slides.md` を持つ deck にページ内 switcher を挿入します
    - dev bridge の実行中だけ active deck に `custom-nav-controls.vue` を生成し、停止時に削除します
- `npm run build`
    - セレクターを表示します
    - 選択したdeckに対して `build` script を実行します
- `npm run export:browser`
    - セレクターを表示します
    - 選択した deck の `/export` ページをブラウザで開きます

### 4. Slidev オプションを渡す

Slidev CLI オプションは `--` の後ろに指定します。

```bash
npm run dev -- -- --port 3030
npm run build -- -- --base /deck/ --output dist/slides
npm run export:browser -- -- --export --port 3030
```

## 想定するプレゼンテーション構成

各プレゼンテーションディレクトリには、次のいずれかが必要です。

- `slides.md`
- `dev`、`build`、`export` script を持つ `package.json`

```text
my-project/
├── package.json
├── vite.config.ts
└── presentations/
    ├── intro/
    │   └── slides.md
    └── advanced/
        ├── package.json
        └── slides.md
```

## dev 中に生成されるファイル

`dev` 実行中だけ、プラグインは active なプレゼンテーションディレクトリに一時ファイルを生成します。

```text
<vite-root>/
└── presentations/
  └── <active-deck>/
    └── custom-nav-controls.vue
```

このファイルは deck 切り替え用のナビゲーションコントロールを提供するために使われ、dev bridge の停止時に削除されます。

## オプション

```ts
presentationManager({
    presentationsDir: 'presentations',
});
```

- `presentationsDir`: プレゼンテーションを走査するディレクトリ。デフォルトは `presentations`
    - 相対パスは Vite root 基準で解決されます

## ディレクトリ構成に関するメモ

このプラグインはパッケージマネージャーのworkspaceを前提にしません。  
次の条件を満たせば、通常のディレクトリ構成でも動作します。

- Vite が意図した project root から起動できること
- `presentationsDir` が Vite root からの相対パス、または絶対パスで正しく deck を指していること
- `@slidev/cli` がプラグイン実行元プロジェクトから解決できること

このリポジトリには、確認済みの sample 構成が `fixture/` 配下に含まれています。

- `fixture/normal`: workspace を使わない通常ディレクトリ構成
- `fixture/workspace`: workspace と共有テーマを含むモノレポ構成

sample のセットアップと実行方法は `fixture/README.md` を参照してください。
