import { render } from 'preact';
import { App } from './app';
import { Landing } from './landing';

const root = document.getElementById('app');
if (!root) throw new Error('#app mount point not found in index.html');

const Page = import.meta.env.DEV ? App : Landing;
render(<Page />, root);
