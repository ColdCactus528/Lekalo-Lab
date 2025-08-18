const HtmlWebpackPlugin = require('html-webpack-plugin');
module.exports = {
  mode: 'development',
  entry: './src/index.js',
  devtool: 'source-map',
  devServer: { port: 5173, open: true, hot: true },
  module: { rules: [{ test: /\.css$/, use: ['style-loader', 'css-loader'] }] },
  plugins: [new HtmlWebpackPlugin({ template: 'public/index.html' }),],
};
