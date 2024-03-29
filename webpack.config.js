const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const WebpackBar = require("webpackbar");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");
const { InjectManifest } = require("workbox-webpack-plugin");
const webpack = require("webpack");
const sveltePreprocess = require("svelte-preprocess");

const mode = process.env.NODE_ENV || "development";
const prod = mode === "production";

module.exports = {
  entry: {
    bundle: ["./src/entrypoints/main.js"],
    android: ["./src/entrypoints/android.js"],
    ios: ["./src/entrypoints/ios.js"],
  },
  resolve: {
    alias: {
      svelte: path.resolve("node_modules", "svelte"),
    },
    extensions: [".mjs", ".js", ".svelte", ".ts", ".tsx", "", ".webpack.js", ".web.js"],
    mainFields: ["svelte", "browser", "module", "main"],
  },
  output: {
    path: `${__dirname}/dist`,
    filename: "[name].js",
    chunkFilename: "[name].js",
  },
  ignoreWarnings: [/Failed to parse source map/],
  module: {
    rules: [
      // All files with a '.ts' or '.tsx' extension will be handled by 'ts-loader'.
      { test: /\.tsx?$/, loader: "ts-loader" },
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
        },
      },
      // All output '.js' files will have any sourcemaps re-processed by 'source-map-loader'.
      { test: /\.(js|tsx?)$/, loader: "source-map-loader" },
      { test: /\.svelte$/,
        use: {
          loader: "svelte-loader",
          options: {
            emitCss: true,
            preprocess: sveltePreprocess({}),
            hotReload: true,
          },
        },
      },
      {
        test: /\.css$/,
        use: [
        /**
          * MiniCssExtractPlugin doesn't support HMR.
          * For developing, use 'style-loader' instead.
          * */
          prod ? MiniCssExtractPlugin.loader : "style-loader",
          "css-loader",
        ],
      },
      {
        test: /\.(png|svg|jpg|gif)$/,
        use: [
          "url-loader",
        ],
      },
    ],
  },
  mode,
  optimization: {
    splitChunks: {
      chunks: "all",
    },
    usedExports: true,
  },
  plugins: [
    new CleanWebpackPlugin(),
    new webpack.DefinePlugin({
      GIT_COMMIT_HASH: JSON.stringify(process.env.COMMIT_REF),
      BACKEND: JSON.stringify(process.env.BACKEND),
    }),
    new HtmlWebpackPlugin({
      filename: "index.html",
      template: "src/html/index.html",
      chunks: ["bundle"],
    }),
    new HtmlWebpackPlugin({
      filename: "android.html",
      template: "src/html/android.html",
      chunks: ["android"],
    }),
    new HtmlWebpackPlugin({
      filename: "ios.html",
      template: "src/html/ios.html",
      chunks: ["ios"],
    }),
    new HtmlWebpackPlugin({
      filename: "imprint.html",
      template: "src/html/imprint.html",
      chunks: [],
    }),
    new HtmlWebpackPlugin({
      filename: "privacy.html",
      template: "src/html/privacy.html",
      chunks: [],
    }),
    new MiniCssExtractPlugin({
      filename: "[name].css",
    }),
    new CopyPlugin({
      patterns: [
        // Copy Shoelace assets to dist/shoelace
        {
          from: path.resolve(__dirname, "node_modules/@shoelace-style/shoelace/dist/assets"),
          to: path.resolve(__dirname, "dist/shoelace/assets"),
        },
        { from: "public" },
      ],
    }),
    new WebpackBar(),
    new InjectManifest({
      swSrc: "./src/sw.js",
      swDest: "sw.js",
      maximumFileSizeToCacheInBytes: 50000000,
      exclude: [
        /volunteers\.png$/,
        /imprint\.html$/,
        /_headers$/,
        /_redirects$/,
        /\.map$/,
        /shoelace\/assets\/icons\/(.*)$/,
      ],
    }),
  ],
  devtool: "source-map",
};
