document.getElementById('save').addEventListener('click', () => {
  document.getElementById('saved').textContent = 'Practice note saved on this page: ' + document.getElementById('note').value;
});
