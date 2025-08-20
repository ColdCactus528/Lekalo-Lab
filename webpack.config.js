const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';

  return {
    mode: isProd ? 'production' : 'development',
    entry: './src/index.js',
    devtool: isProd ? 'source-map' : 'eval-cheap-module-source-map',

    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: isProd ? 'assets/js/[name].[contenthash:8].js' : 'assets/js/[name].js',
      assetModuleFilename: 'assets/[hash][ext][query]',
      clean: true, 
    },

    module: {
      rules: [
        { test: /\.css$/i, use: ['style-loader', 'css-loader'] },
        { test: /\.(png|jpe?g|gif|svg|webp|avif|ico)$/i, type: 'asset', parser: { dataUrlCondition: { maxSize: 8 * 1024 } } },
        { test: /\.(woff2?|ttf|otf|eot)$/i, type: 'asset/resource' },
        {
          test: /\.m?js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: [['@babel/preset-env', { targets: 'defaults, not IE 11', modules: false }]],
            },
          },
        },
      ],
    },

    plugins: [
      new HtmlWebpackPlugin({ template: 'public/index.html', inject: 'body' }),
    ],

    resolve: {
      extensions: ['.js'],
      alias: { '@': path.resolve(__dirname, 'src') },
    },

    optimization: {
      splitChunks: { chunks: 'all' },
    },

    cache: { type: 'filesystem' },
    performance: { hints: false },

    devServer: {
      port: 5173,
      open: true,
      hot: true,
      static: { directory: path.resolve(__dirname, 'public'), watch: true },
      historyApiFallback: true,
      client: { overlay: true },
    },
  };
};
