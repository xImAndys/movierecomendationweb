document.addEventListener('DOMContentLoaded', () => {
    // Copy lobby code to clipboard
    const lobbyCodeElements = document.querySelectorAll('.lobby-code strong');
    lobbyCodeElements.forEach(element => {
        element.addEventListener('click', () => {
            const code = element.textContent;
            navigator.clipboard.writeText(code).then(() => {
                const originalText = element.textContent;
                element.textContent = 'Copied!';
                setTimeout(() => {
                    element.textContent = originalText;
                }, 2000);
            });
        });
    });

    // Confirm movie removal
    const removeForms = document.querySelectorAll('.remove-movie-form');
    removeForms.forEach(form => {
        form.addEventListener('submit', (e) => {
            if (!confirm('Are you sure you want to remove this movie?')) {
                e.preventDefault();
            }
        });
    });
});