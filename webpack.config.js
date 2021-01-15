const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const { CleanWebpackPlugin } = require("clean-webpack-plugin");
const { InjectManifest } = require('workbox-webpack-plugin');

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
    new CopyPlugin({
      patterns: [{
        from: path.resolve(__dirname, 'node_modules/@shoelace-style/shoelace/dist/shoelace/icons'),
        to: path.resolve(__dirname, 'dist/icons'),
      }, { from: 'public' }],
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
    new InjectManifest({
      swSrc: './src/sw.js',
      swDest: 'sw.js',
      maximumFileSizeToCacheInBytes: 8000000,
      include: [
        /\.css$/,
        /\.html$/,
        /\.js$/,
        /\.png$/,
        /site\.webmanifest$/,
      ],
    }),
  ],
  devtool: prod ? false : 'source-map',
};
