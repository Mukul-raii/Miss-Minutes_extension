/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');
const webpack = require('webpack');

/** @type WebpackConfig */
const webExtensionConfig = {
  mode: 'none',
  target: 'node', // Changed to node to support native modules like sqlite3
  entry: {
    'extension': './src/extension.ts',
  },
  output: {
    filename: '[name].js',
    path: path.join(__dirname, './dist'),
    libraryTarget: 'commonjs',
    devtoolModuleFilenameTemplate: '../../[resource-path]'
  },
  resolve: {
    mainFields: ['module', 'main'],
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  plugins: [
    // No need for process/browser shim in node target
  ],
  externals: {
    'vscode': 'commonjs vscode',
    'sqlite3': 'commonjs sqlite3', // Externalize sqlite3
  },
  performance: {
    hints: false
  },
  devtool: 'nosources-source-map',
};

module.exports = [ webExtensionConfig ];

