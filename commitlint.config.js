module.exports = {
    extends: ['@commitlint/config-conventional'],
    ignores: [message => !/^[a-z]+(\([\w-]+\))?:/.test(message)],
    rules: {
        'subject-case': [0, 'never'],
    },
};
