<?php
declare(strict_types=1);
$private = getenv('DZC_ACCOUNT_PRIVATE') ?: dirname(__DIR__, 2) . '/.site-account';
require_once $private . '/app/runtime.php';
\DiegoZC\run($private, 'login');
