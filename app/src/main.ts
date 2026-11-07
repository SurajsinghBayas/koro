import '@fontsource-variable/geist';
import '@fontsource-variable/pixelify-sans';
import { mount } from 'svelte';
import App from './App.svelte';
import './styles/theme.css';
import './styles/app.css';

mount(App, { target: document.getElementById('app')! });
