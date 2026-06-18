const button = document.getElementById('demoButton');

if (button) {
  button.addEventListener('click', () => {
    button.textContent = 'Clicked!';
  });
}
