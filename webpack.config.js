const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const { CleanWebpackPlugin } = require("clean-webpack-plugin");
const { InjectManifest } = require('workbox-webpack-plugin');
const webpack = require('webpack');

const mode = process.env.NODE_ENV || 'development';
const prod = mode === 'production';

module.exports = {
  entry: {
    bundle: ['./src/main.js'],
    android: ['./src/android.js'],
    ios: ['./src/ios.js'],
  },
  resolve: {
    alias: {
      svelte: path.resolve('node_modules', 'svelte'),
    },
    extensions: ['.mjs', '.js', '.svelte'],
    mainFields: ['svelte', 'browser', 'module', 'main'],
  },
  output: {
    path: `${__dirname}/dist`,
    filename: '[name].js',
    chunkFilename: '[name].js',
  },
  module: {
    rules: [{
      test: /\.svelte$/,
      use: {
        loader: 'svelte-loader',
        options: {
          emitCss: true,
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
        prod ? MiniCssExtractPlugin.loader : 'style-loader',
        'css-loader',
      ],
    },
    {
      test: /\.(png|svg|jpg|gif)$/,
      use: [
        'url-loader',
      ],
    },
    ],
  },
  mode,
  optimization: {
    splitChunks: {
      chunks: "all",
    },
  },
  plugins: [
    new CleanWebpackPlugin(),
    new webpack.DefinePlugin({
      GIT_COMMIT_HASH: JSON.stringify(process.env.COMMIT_REF),
      BACKEND: JSON.stringify(process.env.BACKEND),
    }),
    new HtmlWebpackPlugin({
      filename: 'index.html',
      template: 'src/html/index.html',
      chunks: ['bundle'],
    }),
    new HtmlWebpackPlugin({
      filename: 'android.html',
      template: 'src/html/android.html',
      chunks: ['android'],
    }),
    new HtmlWebpackPlugin({
      filename: 'ios.html',
      template: 'src/html/ios.html',
      chunks: ['ios'],
    }),
    new HtmlWebpackPlugin({
      filename: 'imprint.html',
      template: 'src/html/imprint.html',
      chunks: [],
    }),
    new HtmlWebpackPlugin({
      filename: 'privacy.html',
      template: 'src/html/privacy.html',
      chunks: [],
    }),
    new MiniCssExtractPlugin({
      filename: '[name].css',
    }),
    new CopyPlugin({
      patterns: [
        // Copy Shoelace assets to dist/shoelace
        {
          from: path.resolve(__dirname, 'node_modules/@shoelace-style/shoelace/dist/assets'),
          to: path.resolve(__dirname, 'dist/shoelace/assets')
        },
        { from: 'public' }
      ]
    }),
    new InjectManifest({
      swSrc: './src/sw.js',
      swDest: 'sw.js',
      maximumFileSizeToCacheInBytes: 8000000,
      include: [
        /\.css$/,
        /\.html$/,
        /\.js$/,
        /\.png$/,
        // https://github.com/shoelace-style/shoelace/issues/297
        /exclamation-triangle\.svg$/,
        /x\.svg$/,
        /site\.webmanifest$/,
      ],
    }),
  ],
  devtool: 'source-map',
};
