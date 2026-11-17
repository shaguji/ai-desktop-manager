import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { Finder } from './components/Finder';
import './styles/global.css';

/* 同一个 index.html 承载三种界面：桌面层 / 设置窗口 / 本地查找面板 */
const isFinder = location.hash === '#finder';

createRoot(document.getElementById('root')!).render(isFinder ? <Finder /> : <App />);
